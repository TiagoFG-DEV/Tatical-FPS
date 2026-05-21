import type { Socket } from 'socket.io-client';
import type { PlayerInput, ServerCorrection, ServerToClientEvents, ClientToServerEvents } from '@tactical-fps/shared';
import { GAME_CONSTANTS } from '@tactical-fps/shared';
import { useGameStore } from '../stores/gameStore';

// ─────────────────────────────────────────
// InputSystem — keyboard/mouse capture,
// client-side prediction, reconciliation
// ─────────────────────────────────────────
interface InputCallbacks {
  onBuyMenu: (open: boolean) => void;
  onScoreboard: (open: boolean) => void;
}

export class InputSystem {
  private canvas: HTMLCanvasElement;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private myId: string;
  private callbacks: InputCallbacks;

  // Input state
  private keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private shooting = false;
  private seq = 0;

  // Prediction state
  private predictedPos = { x: 0, y: 0 };
  private predictedVel = { x: 0, y: 0 };
  private pendingInputs: PlayerInput[] = [];

  // Internals
  private frameId = 0;
  private lastFrameTime = 0;
  private buyMenuOpen = false;
  private scoreboardOpen = false;

  constructor(
    canvas: HTMLCanvasElement,
    socket: Socket<ServerToClientEvents, ClientToServerEvents>,
    myId: string,
    callbacks: InputCallbacks,
    private renderer: any
  ) {
    this.canvas = canvas;
    this.socket = socket;
    this.myId = myId;
    this.callbacks = callbacks;
  }

  attach(): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel);
    window.addEventListener('blur', this.onBlur);
    this.frameId = requestAnimationFrame(this.loop);
  }

  detach(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    cancelAnimationFrame(this.frameId);
  }

  // ─── Main loop — runs at rAF speed ───────
  private loop = (time: number): void => {
    const dt = Math.min((time - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = time;

    if (!this.scoreboardOpen) {
      this.sendInput(dt);
    } else {
      // Send a neutral input only when the scoreboard is open to prevent moving while holding Tab
      this.sendNeutralInput();
    }

    this.frameId = requestAnimationFrame(this.loop);
  };

  private sendInput(dt: number): void {
    const rect = this.canvas.getBoundingClientRect();
    
    let playerScreenX = rect.left + rect.width / 2;
    let playerScreenY = rect.top + rect.height / 2;
    
    if (this.renderer) {
      const pos = this.renderer.getPlayerScreenPos();
      if (pos) {
        playerScreenX = rect.left + pos.x;
        playerScreenY = rect.top + pos.y;
      }
    }

    const angle = Math.atan2(this.mouseY - playerScreenY, this.mouseX - playerScreenX);

    const moveX = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
                - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const moveY = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
                - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);

    const input: PlayerInput = {
      seq: ++this.seq,
      timestamp: Date.now(),
      moveX,
      moveY,
      angle,
      shooting: this.shooting,
      reloading: this.keys.has('KeyR'),
      crouching: this.keys.has('ControlLeft') || this.keys.has('ControlRight'),
      walking: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      jumping: this.keys.has('Space'),
      plantDefuse: this.keys.has('KeyQ'),
      pickupDrop: this.keys.has('KeyE'),
      dropWeapon: this.keys.has('KeyG'),
      switchWeapon: this.pendingSwitchWeapon || (
                    this.keys.has('Digit1') ? 'melee'
                  : this.keys.has('Digit2') ? 'secondary'
                  : this.keys.has('Digit3') ? 'primary'
                  : this.keys.has('Digit4') ? 'nuke'
                  : null),
    };
    this.pendingSwitchWeapon = null;

    this.socket.emit('player_input', input);

    // Client-side prediction for local rendering
    const speed = input.crouching ? GAME_CONSTANTS.PLAYER_CROUCH_SPEED
                : input.walking ? GAME_CONSTANTS.PLAYER_SPEED
                : GAME_CONSTANTS.PLAYER_RUN_SPEED;

    const len = Math.hypot(moveX, moveY);
    
    // Check if we are locked in place by plant/defuse
    const snap = useGameStore.getState().snapshot;
    let isLocked = false;
    if (snap) {
      const spike = snap.spike;
      if (spike.carrierId === this.myId && spike.plantProgress > 0) isLocked = true;
      if (spike.defuserId === this.myId && spike.defuseProgress > 0) isLocked = true;
    }

    if (len > 0 && !isLocked) {
      this.predictedVel = {
        x: (moveX / len) * speed,
        y: (moveY / len) * speed,
      };
    } else {
      this.predictedVel = { x: 0, y: 0 };
    }

    this.predictedPos = {
      x: this.predictedPos.x + this.predictedVel.x * dt,
      y: this.predictedPos.y + this.predictedVel.y * dt,
    };

    // Store for reconciliation
    this.pendingInputs.push(input);
    if (this.pendingInputs.length > 120) this.pendingInputs.shift();
  }

  // ─── Server reconciliation ────────────────
  applyCorrection(correction: ServerCorrection): void {
    // Remove acknowledged inputs
    this.pendingInputs = this.pendingInputs.filter(i => i.seq > correction.seq);

    // Reset to server authoritative position
    this.predictedPos = { ...correction.position };
    this.predictedVel = { ...correction.velocity };

    // Re-apply unacknowledged inputs
    for (const input of this.pendingInputs) {
      const speed = input.crouching ? GAME_CONSTANTS.PLAYER_CROUCH_SPEED
                  : input.walking ? GAME_CONSTANTS.PLAYER_SPEED
                  : GAME_CONSTANTS.PLAYER_RUN_SPEED;
      const len = Math.hypot(input.moveX, input.moveY);
      if (len > 0) {
        this.predictedPos.x += (input.moveX / len) * speed * (1 / 60);
        this.predictedPos.y += (input.moveY / len) * speed * (1 / 60);
      }
    }
  }

  getPredictedPosition() { return this.predictedPos; }
  getPredictedAngle() {
    const rect = this.canvas.getBoundingClientRect();
    return Math.atan2(this.mouseY - (rect.top + rect.height / 2), this.mouseX - (rect.left + rect.width / 2));
  }

  private pendingSwitchWeapon: string | null = null;

  private onWheel = (e: WheelEvent): void => {
    if (e.deltaY < 0) {
      this.pendingSwitchWeapon = 'prev';
    } else if (e.deltaY > 0) {
      this.pendingSwitchWeapon = 'next';
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);

    if (e.code === 'KeyB') {
      const phase = useGameStore.getState().snapshot?.round.phase;
      if (phase === 'buy') {
        this.buyMenuOpen = !this.buyMenuOpen;
        this.callbacks.onBuyMenu(this.buyMenuOpen);
      }
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      this.scoreboardOpen = true;
      this.callbacks.onScoreboard(true);
    }
    if (e.code === 'Escape') {
      this.buyMenuOpen = false;
      this.callbacks.onBuyMenu(false);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'Tab') {
      this.scoreboardOpen = false;
      this.callbacks.onScoreboard(false);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.shooting = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.shooting = false;
  };

  private onContextMenu = (e: Event): void => e.preventDefault();

  // Clear all input state when browser loses focus to prevent stuck keys
  private onBlur = (): void => {
    this.keys.clear();
    this.shooting = false;
  };

  private sendNeutralInput(): void {
    const rect = this.canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(this.mouseY - centerY, this.mouseX - centerX);
    this.socket.emit('player_input', {
      seq: ++this.seq,
      timestamp: Date.now(),
      moveX: 0,
      moveY: 0,
      angle,
      shooting: false,
      reloading: false,
      crouching: false,
      walking: false,
      jumping: false,
      plantDefuse: false,
      pickupDrop: false,
      dropWeapon: false,
      switchWeapon: null,
    });
  }
}
