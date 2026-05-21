import type { PlayerState, MapDefinition, Vec2 } from '@tactical-fps/shared';
import { GAME_CONSTANTS } from '@tactical-fps/shared';
import { PhysicsSystem } from './PhysicsSystem';

export class VisibilitySystem {
  private physics: PhysicsSystem;

  constructor(map: MapDefinition) {
    this.physics = new PhysicsSystem(map);
  }

  getVisiblePlayers(viewer: PlayerState, allPlayers: PlayerState[]): Set<string> {
    const visible = new Set<string>();
    if (viewer.status !== 'alive') return visible;

    for (const other of allPlayers) {
      if (other.id === viewer.id) continue;
      if (other.team === viewer.team) { visible.add(other.id); continue; }
      if (other.status !== 'alive') continue;

      const dist = Math.hypot(other.position.x - viewer.position.x, other.position.y - viewer.position.y);
      if (dist > GAME_CONSTANTS.VISION_RANGE) continue;

      if (this.physics.hasLineOfSight(viewer.position, other.position)) {
        visible.add(other.id);
      }
    }
    return visible;
  }

  // Returns visible wall endpoints for client fog-of-war rendering
  computeFogPolygon(viewer: Vec2, maxRange: number): Vec2[] {
    const angles: number[] = [];
    const step = (2 * Math.PI) / GAME_CONSTANTS.VISION_RAYS;
    for (let i = 0; i < GAME_CONSTANTS.VISION_RAYS; i++) {
      angles.push(i * step);
    }

    return angles.map(angle => {
      const dir: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
      const result = this.physics.raycast(viewer, dir, maxRange);
      return result.point;
    });
  }
}
