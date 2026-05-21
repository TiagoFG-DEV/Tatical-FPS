import type { PlayerState, PlayerInput } from '@tactical-fps/shared';
import { GAME_CONSTANTS } from '@tactical-fps/shared';

// Max speed: run speed * knife boost (1.8x) * diagonal factor * generous lag tolerance
const MAX_SPEED = GAME_CONSTANTS.PLAYER_RUN_SPEED * 1.8 * Math.SQRT2 * 1.4;
const GRACE_PX  = 25;  // pixel buffer for physics edge cases
const MIN_MS    = 16;  // skip checks shorter than ~1 tick to avoid tiny-elapsed false positives

export class AntiCheatSystem {
  private lastPositions = new Map<string, { x: number; y: number; time: number }>();

  validateInput(player: PlayerState, input: PlayerInput, receivedAt: number): boolean {
    const last = this.lastPositions.get(player.id);

    if (last) {
      const elapsed = receivedAt - last.time; // ms
      if (elapsed >= MIN_MS) {
        const maxTravel = (MAX_SPEED * elapsed / 1000) + GRACE_PX;
        const actual = Math.hypot(
          player.position.x - last.x,
          player.position.y - last.y,
        );
        if (actual > maxTravel) {
          // Log-only — do not drop input to avoid false-positive freezes during lag spikes
          console.warn(`[AntiCheat] Suspicious: ${player.id} moved ${actual.toFixed(0)}px in ${elapsed}ms (max ${maxTravel.toFixed(0)}px)`);
        }
      }
    }

    this.lastPositions.set(player.id, {
      x: player.position.x,
      y: player.position.y,
      time: receivedAt,
    });

    // Sequence sanity
    if (input.seq < 0 || input.seq > 1_000_000) return false;

    // Angle sanity
    if (!isFinite(input.angle)) return false;

    return true;
  }

  // Call after teleport (spawn/round reset) so next check has a clean baseline
  resetPlayer(playerId: string): void {
    this.lastPositions.delete(playerId);
  }
}
