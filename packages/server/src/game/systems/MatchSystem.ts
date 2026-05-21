import { Server } from 'socket.io';
import type {
  PlayerState, SpikeState, RoundState, RoundWinner, RoundEndReason,
  ServerToClientEvents, ClientToServerEvents, MatchResult,
} from '@tactical-fps/shared';
import { GAME_CONSTANTS } from '@tactical-fps/shared';
import { EconomySystem } from './EconomySystem';

type MatchEventCallback = (event: string) => void;

export class MatchSystem {
  private lossStreak = new Map<string, number>();
  private roundEndPending = false;

  createInitialRound(): RoundState {
    return {
      round: 1,
      phase: 'waiting',
      phaseEndTime: 0,
      attackerScore: 0,
      defenderScore: 0,
      roundWinner: null,
      roundEndReason: null,
      barriersUp: true,
      isOvertime: false,
      overtimeRound: 0,
    };
  }

  tick(
    round: RoundState,
    now: number,
    players: Map<string, PlayerState>,
    spike: SpikeState,
    economy: EconomySystem,
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    code: string,
    onEvent: MatchEventCallback,
  ): void {
    if (round.phase === 'waiting' || round.phase === 'round_end' || round.phase === 'match_end') return;

    // Phase timer
    if (now >= round.phaseEndTime && round.phase === 'buy') {
      round.phase = 'combat';
      round.barriersUp = false;
      round.phaseEndTime = now + GAME_CONSTANTS.ROUND_DURATION;
    }

    // Time expired in combat (no plant)
    if (now >= round.phaseEndTime && round.phase === 'combat') {
      this.endRound(round, 'defenders', 'time_expired', players, economy, io, code, onEvent);
    }

    // Elimination checks
    if (!this.roundEndPending) {
      this.checkRoundEnd(round, players, spike);
      if (round.roundWinner) {
        this.endRound(round, round.roundWinner, round.roundEndReason as RoundEndReason, players, economy, io, code, onEvent);
      }
    }
  }

  checkRoundEnd(
    round: RoundState,
    players: Map<string, PlayerState>,
    spike: SpikeState,
  ): void {
    if (round.phase === 'round_end' || round.phase === 'match_end') return;

    const playersArr = Array.from(players.values());
    const alive = playersArr.filter(p => p.status === 'alive');
    const atkAlive = alive.filter(p => p.team === 'attackers').length;
    const defAlive = alive.filter(p => p.team === 'defenders').length;

    const atkTotal = playersArr.filter(p => p.team === 'attackers').length;
    const defTotal = playersArr.filter(p => p.team === 'defenders').length;

    if (atkTotal > 0 && atkAlive === 0 && spike.status !== 'planted') {
      round.roundWinner = 'defenders';
      round.roundEndReason = 'attackers_eliminated';
    } else if (defTotal > 0 && defAlive === 0) {
      round.roundWinner = 'attackers';
      round.roundEndReason = 'defenders_eliminated';
    }
  }

  endRound(
    round: RoundState,
    winner: RoundWinner,
    reason: RoundEndReason,
    players: Map<string, PlayerState>,
    economy: EconomySystem,
    io: Server<ClientToServerEvents, ServerToClientEvents>,
    roomCode: string,
    onEvent: MatchEventCallback,
  ): void {
    if (round.phase === 'round_end' || round.phase === 'match_end') return;
    this.roundEndPending = true;

    round.roundWinner = winner;
    round.roundEndReason = reason;
    round.phase = 'round_end';
    round.phaseEndTime = Date.now() + GAME_CONSTANTS.ROUND_END_DELAY;

    if (winner === 'attackers') round.attackerScore++;
    else if (winner === 'defenders') round.defenderScore++;

    // Economy
    const updates = winner ? economy.awardRoundEnd(players, winner, this.lossStreak) : [];

    if (io && roomCode) {
      io.to(roomCode).emit('round_end', round, updates);
    }

    // Check match end
    const matchDone = this.checkMatchEnd(round);

    if (matchDone && io && roomCode) {
      round.phase = 'match_end';
      const mvp = this.findMvp(players);
      const result: MatchResult = {
        winner: winner as 'attackers' | 'defenders',
        attackerScore: round.attackerScore,
        defenderScore: round.defenderScore,
        mvpId: mvp?.id ?? '',
        players: Array.from(players.values()).map(p => ({
          id: p.id, name: p.name,
          kills: p.kills, deaths: p.deaths, assists: p.assists,
        })),
      };
      setTimeout(() => {
        io.to(roomCode).emit('match_end', result);
        onEvent('match_end');
      }, GAME_CONSTANTS.ROUND_END_DELAY);
    } else {
      // Start next round after delay
      setTimeout(() => {
        this.roundEndPending = false;
        round.round++;

        // Halftime at 12 total points (Valorant style)
        const totalPoints = round.attackerScore + round.defenderScore;
        if (totalPoints === 12) {
          round.phase = 'halftime';
          // Swap sides and scores
          for (const [, p] of players) {
            p.team = p.team === 'attackers' ? 'defenders' : 'attackers';
            
            // Reset economy and inventory for the new half
            p.credits = GAME_CONSTANTS.STARTING_CREDITS;
            p.weapons = ['classic', 'knife'];
            p.activeWeapon = 'classic';
            p.armor = 0;
            p.armorType = 'none';
            p.hasHelmet = false;
            p.hasSpike = false;
          }
          const tempScore = round.attackerScore;
          round.attackerScore = round.defenderScore;
          round.defenderScore = tempScore;

          // After halftime delay, start buy phase
          setTimeout(() => {
             onEvent('round_end_buy');
          }, GAME_CONSTANTS.HALFTIME_DELAY);
        } else {
           onEvent('round_end_buy');
        }
      }, GAME_CONSTANTS.ROUND_END_DELAY);
    }
  }

  private checkMatchEnd(round: RoundState): boolean {
    const target = GAME_CONSTANTS.ROUNDS_TO_WIN;
    return round.attackerScore >= target || round.defenderScore >= target;
  }

  private findMvp(players: Map<string, PlayerState>): PlayerState | null {
    let best: PlayerState | null = null;
    for (const [, p] of players) {
      if (!best || p.kills > best.kills) best = p;
    }
    return best;
  }
}
