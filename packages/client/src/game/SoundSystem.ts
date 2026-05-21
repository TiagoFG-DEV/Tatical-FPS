// ─────────────────────────────────────────
// SOUND SYSTEM — Procedural WebAudio
// All sounds generated synthetically — zero assets needed
// Spatial audio: distanceFactor 0..1 (1 = at source)
// ─────────────────────────────────────────

import type { GameSnapshot } from '@tactical-fps/shared';

type WeaponSoundProfile = {
  baseFreq: number;
  endFreq: number;
  duration: number;
  noiseRatio: number;   // 0 = pure tone, 1 = pure noise
  oscType: OscillatorType;
  volume: number;
  crackle: boolean;     // extra high-freq crack layer (rifles)
  mechanical: boolean;  // metallic click (pistols/semi)
};

const WEAPON_PROFILES: Record<string, WeaponSoundProfile> = {
  classic: { baseFreq: 180, endFreq: 40, duration: 0.18, noiseRatio: 0.35, oscType: 'square', volume: 0.45, crackle: false, mechanical: true },
  ghost: { baseFreq: 160, endFreq: 38, duration: 0.16, noiseRatio: 0.30, oscType: 'square', volume: 0.40, crackle: false, mechanical: true },
  sheriff: { baseFreq: 220, endFreq: 50, duration: 0.28, noiseRatio: 0.50, oscType: 'sawtooth', volume: 0.70, crackle: true, mechanical: true },
  spectre: { baseFreq: 200, endFreq: 45, duration: 0.13, noiseRatio: 0.40, oscType: 'square', volume: 0.50, crackle: false, mechanical: false },
  phantom: { baseFreq: 280, endFreq: 60, duration: 0.22, noiseRatio: 0.55, oscType: 'sawtooth', volume: 0.65, crackle: true, mechanical: false },
  vandal: { baseFreq: 300, endFreq: 65, duration: 0.25, noiseRatio: 0.60, oscType: 'sawtooth', volume: 0.75, crackle: true, mechanical: false },
  operator: { baseFreq: 380, endFreq: 30, duration: 0.50, noiseRatio: 0.70, oscType: 'sawtooth', volume: 1.0, crackle: true, mechanical: true },
  judge: { baseFreq: 140, endFreq: 20, duration: 0.35, noiseRatio: 0.80, oscType: 'square', volume: 0.90, crackle: false, mechanical: true },
  ares: { baseFreq: 230, endFreq: 50, duration: 0.20, noiseRatio: 0.55, oscType: 'sawtooth', volume: 0.65, crackle: true, mechanical: false },
  odin: { baseFreq: 260, endFreq: 55, duration: 0.22, noiseRatio: 0.58, oscType: 'sawtooth', volume: 0.70, crackle: true, mechanical: false },
  knife: { baseFreq: 800, endFreq: 400, duration: 0.08, noiseRatio: 0.15, oscType: 'triangle', volume: 0.20, crackle: false, mechanical: true },
};

export class SoundSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  
  // Ambient tension loop
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private isAmbientPlaying = false;

  // Local procedural trackers
  private lastFootsteps = new Map<string, number>();
  private lastSpikeBeep = 0;
  private currentPhase = '';

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ─── Local Schedulers (Client-side driven) ─────────────────
  
  update(snapshot: GameSnapshot, myId: string) {
    this.init();
    if (!this.ctx || !this.masterGain) return;

    const now = Date.now();
    const me = snapshot.players.find(p => p.id === myId);

    // 1. Ambient Tension (Only during active round)
    if (snapshot.round.phase === 'combat' && !this.isAmbientPlaying) {
      this.startAmbient();
    } else if (snapshot.round.phase !== 'combat' && this.isAmbientPlaying) {
      this.stopAmbient();
    }

    // 2. Client-side Footsteps
    for (const p of snapshot.players) {
      if (p.status !== 'alive') continue;
      
      const speed = Math.hypot(p.velocity.x, p.velocity.y);
      if (speed < 20) continue; // Stationary — skip

      // MODO SILENCIOSO (Shift held): isWalking=true → NO footstep sound.
      // isWalking is set server-side from input.walking (ShiftLeft/ShiftRight).
      // This is the correct fix: velocity alone cannot distinguish shift-walk
      // from normal walk because PLAYER_SPEED=180 > old threshold of 140.
      if (p.isWalking) continue;

      // Crouching is also silent (speed < CROUCH_SPEED ~100)
      if (speed < 120) continue;

      const interval = 280; // ms between footstep sounds (run cadence)
      
      const last = this.lastFootsteps.get(p.id) ?? 0;
      if (now - last > interval) {
        this.lastFootsteps.set(p.id, now);
        
        let distanceFactor = 1;
        if (me && p.id !== myId) {
          const dist = Math.hypot(p.position.x - me.position.x, p.position.y - me.position.y);
          distanceFactor = Math.max(0, 1 - dist / 600);
        }
        
        if (distanceFactor > 0.01) {
          const adjustedVolume = distanceFactor * distanceFactor;
          this.playFootstep(adjustedVolume, 'run', 'default');
        }
      }
    }


    // 3. Client-side Spike Beep
    if (snapshot.spike.status === 'planted' && snapshot.spike.explodeTime) {
      const remaining = Math.max(0, snapshot.spike.explodeTime - now);
      if (remaining > 0) {
        const beepInterval = Math.max(100, remaining / 15);
        if (now - this.lastSpikeBeep > beepInterval) {
          this.lastSpikeBeep = now;
          
          let distanceFactor = 1;
          if (me) {
            const dist = Math.hypot(snapshot.spike.position.x - me.position.x, snapshot.spike.position.y - me.position.y);
            distanceFactor = Math.max(0, 1 - dist / 3000); // Heard from very far
          }
          this.playBeep(distanceFactor * 1.5, 1200, 0.08, 'square');
        }
      }
    }
  }

  // ─── Ambient ─────────────────────────────
  private startAmbient() {
    if (!this.ctx || !this.masterGain) return;
    this.ambientOsc = this.ctx.createOscillator();
    this.ambientGain = this.ctx.createGain();
    
    // Very low, unsettling drone
    this.ambientOsc.type = 'sine';
    this.ambientOsc.frequency.value = 55; // Low A
    
    // Slow LFO for volume pulsing
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1; // 10s cycle
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.03;
    
    lfo.connect(lfoGain);
    lfoGain.connect(this.ambientGain.gain);
    
    this.ambientGain.gain.value = 0.04;
    this.ambientOsc.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    
    this.ambientOsc.start();
    lfo.start();
    
    this.isAmbientPlaying = true;
  }

  private stopAmbient() {
    if (this.ambientOsc && this.ambientGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.ambientGain.gain.linearRampToValueAtTime(0.001, now + 1);
      this.ambientOsc.stop(now + 1);
    }
    this.isAmbientPlaying = false;
  }

  // ─── Public API (Network Events) ─────────
  play(type: string, distanceFactor: number = 1, args: Record<string, any> = {}) {
    this.init();
    if (!this.ctx || !this.masterGain) return;
    const vol = Math.max(0, Math.min(1, distanceFactor));
    if (vol < 0.01) return;

    switch (type) {
      case 'gunshot':
        this.playGunshot(vol, args.weaponId ?? 'classic');
        break;
      case 'reload':
        this.playReload(vol, args.weaponId ?? 'classic');
        break;
      case 'low_ammo':
        this.playBeep(vol, 440, 0.04, 'square');
        break;
      case 'spike_plant_complete':
        this.playSpikePlant(vol);
        break;
      case 'spike_explode':
        this.playExplosion(vol);
        break;
      case 'defuse_start':
        this.playBeep(vol, 660, 0.3, 'sine');
        break;
      case 'defuse_complete':
        this.playDefuseComplete(vol);
        break;
      case 'round_start':
        this.playRoundStart(vol);
        break;
      case 'round_end_win':
        this.playBeep(vol, 880, 0.4, 'sine');
        break;
      case 'round_end_lose':
        this.playBeep(vol, 220, 0.4, 'sine');
        break;
      case 'knife_swing':
        this.playKnifeSwing(vol);
        break;
      case 'bullet_impact_wall':
        this.playImpact(vol, 'wall');
        break;
      case 'bullet_impact_player':
        this.playImpact(vol, 'player');
        break;
      case 'teleport':
        this.playTeleport(vol);
        break;
    }
  }

  // ─── Instruments ─────────────────────────────
  
  private playTeleport(vol: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    gain.gain.setValueAtTime(vol * 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t); osc.stop(t + 0.5);
    
    this.playNoise(t, 0.4, vol * 0.3, 1000, 2000);
  }

  private playGunshot(vol: number, weaponId: string) {
    if (!this.ctx || !this.masterGain) return;
    const profile = WEAPON_PROFILES[weaponId] ?? WEAPON_PROFILES.classic;
    const now = this.ctx.currentTime;
    const dur = profile.duration;

    // Body tone
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = profile.oscType;
    osc.frequency.setValueAtTime(profile.baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(profile.endFreq, now + dur);
    const oscVol = vol * profile.volume * (1 - profile.noiseRatio);
    oscGain.gain.setValueAtTime(oscVol, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur);

    // Noise blast
    const noiseVol = vol * profile.volume * profile.noiseRatio;
    if (noiseVol > 0.01) {
      this.playNoise(now, dur * 0.8, noiseVol, 800, 60);
    }

    // High frequency crack
    if (profile.crackle) {
      this.playNoise(now, 0.03, vol * profile.volume * 0.4, 3000, 1000);
    }

    // Mechanical click
    if (profile.mechanical) {
      this.playMechClick(now + dur * 0.7, vol * 0.15, 2000);
    }
  }

  private playFootstep(vol: number, speed: 'run' | 'walk', surface: string) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const duration = speed === 'run' ? 0.12 : 0.08;
    const baseVol = vol * (speed === 'run' ? 0.35 : 0.15); // increased base volume

    let freqStart = 80, freqEnd = 30, filterFreq = 400;

    // The scuff noise (shoe hitting ground)
    this.playNoise(t, duration, baseVol * 1.5, filterFreq, freqEnd);

    // The heavy thud (bass resonance)
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'triangle'; // Better than sine for punch
    thud.frequency.setValueAtTime(freqStart + 40, t);
    thud.frequency.exponentialRampToValueAtTime(freqEnd, t + duration * 1.5);
    thudGain.gain.setValueAtTime(baseVol * 2.0, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + duration * 1.5);
    thud.connect(thudGain);
    thudGain.connect(this.masterGain);
    thud.start(t); thud.stop(t + duration * 1.5);
  }

  private playReload(vol: number, weaponId: string) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const isShotgun = weaponId === 'judge';
    const isSniper = weaponId === 'operator';

    if (isShotgun) {
      this.playMechClick(t, vol, 1200);
      this.playMechClick(t + 0.25, vol, 800);
    } else if (isSniper) {
      this.playNoise(t, 0.15, vol * 0.35, 500, 80);
      this.playMechClick(t + 0.15, vol, 600);
      this.playNoise(t + 0.3, 0.12, vol * 0.25, 400, 60);
    } else {
      this.playNoise(t, 0.08, vol * 0.25, 600, 100);
      this.playMechClick(t + 0.12, vol * 0.6, 1000);
      this.playMechClick(t + 0.22, vol * 0.4, 1600);
    }
  }

  private playImpact(vol: number, type: 'wall' | 'player') {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    if (type === 'wall') {
      this.playNoise(t, 0.06, vol * 0.20, 1500, 200);
    } else {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);
      gain.gain.setValueAtTime(vol * 0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t); osc.stop(t + 0.1);
    }
  }

  private playSpikePlant(vol: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    [0, 0.15, 0.30].forEach((offset, i) => {
      const freq = 660 + i * 220;
      this.playBeep(vol, freq, 0.12, 'square', t + offset);
    });
  }

  private playDefuseComplete(vol: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    [880, 1100, 1320].forEach((freq, i) => {
      this.playBeep(vol, freq, 0.2, 'sine', t + i * 0.12);
    });
  }

  private playRoundStart(vol: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    this.playBeep(vol * 0.6, 440, 0.1, 'sine', t);
    this.playBeep(vol * 0.8, 660, 0.15, 'sine', t + 0.15);
  }

  private playKnifeSwing(vol: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    this.playNoise(t, 0.06, vol * 0.25, 4000, 800);
  }

  private playExplosion(vol: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(60, t);
    sub.frequency.exponentialRampToValueAtTime(20, t + 2.5);
    subGain.gain.setValueAtTime(vol * 0.9, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(t); sub.stop(t + 2.5);

    this.playNoise(t, 2.0, vol * 1.0, 1800, 30);
    this.playNoise(t, 0.08, vol * 0.8, 8000, 2000);
  }

  // ─── Base Generators ─────────────────────
  
  private playNoise(
    time: number, duration: number, vol: number,
    filterStart: number, filterEnd: number,
  ) {
    if (!this.ctx || !this.masterGain) return;
    const bufferSize = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterStart, time);
    if (filterEnd > 0.1) {
      filter.frequency.exponentialRampToValueAtTime(filterEnd, time + duration);
    }
    filter.Q.value = 1.5;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(time);
  }

  private playBeep(vol: number, freq: number, duration: number, type: OscillatorType, startTime?: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = startTime ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol * 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + duration);
  }

  private playMechClick(time: number, vol: number, freq: number) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.3, time + 0.04);
    gain.gain.setValueAtTime(vol * 0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.07);
  }
}

export const soundSystem = new SoundSystem();
