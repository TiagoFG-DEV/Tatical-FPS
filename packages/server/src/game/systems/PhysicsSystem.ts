import type { Vec2, MapDefinition } from '@tactical-fps/shared';
import { GAME_CONSTANTS } from '@tactical-fps/shared';

// ─────────────────────────────────────────
// PhysicsSystem — movement, collision, raycasting
// Uses circle sweep collision against line segments
// ─────────────────────────────────────────
export class PhysicsSystem {
  private walls: { x1: number; y1: number; x2: number; y2: number }[];
  private barriers: { id: string; type: string; polygon: Vec2[] }[];
  // Pre-computed barrier edges for fast raycast checks
  private barrierSegments: { x1: number; y1: number; x2: number; y2: number }[] = [];

  constructor(map: MapDefinition) {
    this.walls = map.walls;
    this.barriers = map.zones.filter(z => z.type === 'barrier');
    // Build barrier edge list once at construction time
    for (const barrier of this.barriers) {
      const poly = barrier.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        this.barrierSegments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
  }

  // ─── Move with sliding collision ─────────
  move(position: Vec2, velocity: Vec2, dt: number, radius: number, checkBarriers = false, team: string = ''): Vec2 {
    const desired: Vec2 = {
      x: position.x + velocity.x * dt,
      y: position.y + velocity.y * dt,
    };

    const resolved = this.resolveCollision(position, desired, radius, checkBarriers, team);
    return resolved;
  }

  // ─── Circle vs segment collision ─────────
  private resolveCollision(from: Vec2, to: Vec2, radius: number, checkBarriers = false, team = ''): Vec2 {
    let pos = { ...to };

    // Walls
    for (const wall of this.walls) {
      pos = this.collideWithSegment(pos, { x: wall.x1, y: wall.y1, x2: wall.x2, y2: wall.y2 }, radius);
    }

    // Barriers
    if (checkBarriers) {
      for (const barrier of this.barriers) {
        // Barriers are polygons, we treat their edges as walls
        for (let i = 0; i < barrier.polygon.length; i++) {
          const a = barrier.polygon[i];
          const b = barrier.polygon[(i + 1) % barrier.polygon.length];
          pos = this.collideWithSegment(pos, { x: a.x, y: a.y, x2: b.x, y2: b.y }, radius);
        }
      }
    }

    return pos;
  }

  /**
   * Applies ice-skating friction to velocity when holding a knife.
   * Instead of instantly matching desired velocity, the actual velocity
   * lerps toward it slowly — giving a slippery, momentum-heavy feel.
   * @param currentVel Current physics velocity
   * @param desiredVel Desired velocity from input
   * @param dt Delta time in seconds
   * @returns New blended velocity
   */
  applyKnifeFriction(currentVel: Vec2, desiredVel: Vec2, dt: number): Vec2 {
    // Friction factor: lower = more slippery. 3.0 gives a gentle skate feel.
    const friction = 3.0;
    return {
      x: currentVel.x + (desiredVel.x - currentVel.x) * Math.min(1, friction * dt),
      y: currentVel.y + (desiredVel.y - currentVel.y) * Math.min(1, friction * dt),
    };
  }

  isPointInZone(p: Vec2, zone: { polygon: Vec2[] }): boolean {
    return this.pointInPolygon(p, zone.polygon);
  }

  private pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private collideWithSegment(pos: Vec2, wall: { x: number; y: number; x2: number; y2: number }, radius: number): Vec2 {
    const seg = { ax: wall.x, ay: wall.y, bx: wall.x2, by: wall.y2 };
    const closest = this.closestPointOnSegment(pos, seg);
    const dx = pos.x - closest.x;
    const dy = pos.y - closest.y;
    const dist = Math.hypot(dx, dy);

    if (dist < radius && dist > 0.001) {
      const nx = dx / dist;
      const ny = dy / dist;
      return {
        x: closest.x + nx * (radius + 0.5),
        y: closest.y + ny * (radius + 0.5),
      };
    }
    return pos;
  }

  // ─── Raycast for hitscan / LOS ───────────
  // Returns distance to first wall hit, or Infinity.
  // Pass checkBarriers=true during buy phase so bullets stop at barriers.
  raycast(origin: Vec2, direction: Vec2, maxDist: number, checkBarriers = false): { hit: boolean; dist: number; point: Vec2 } {
    let minDist = maxDist;
    let hitPoint = {
      x: origin.x + direction.x * maxDist,
      y: origin.y + direction.y * maxDist,
    };

    const segments = checkBarriers
      ? [...this.walls, ...this.barrierSegments]
      : this.walls;

    for (const wall of segments) {
      const result = this.raySegmentIntersect(
        origin, direction,
        { x: wall.x1, y: wall.y1 },
        { x: wall.x2, y: wall.y2 },
      );
      if (result !== null && result < minDist) {
        minDist = result;
        hitPoint = {
          x: origin.x + direction.x * minDist,
          y: origin.y + direction.y * minDist,
        };
      }
    }

    return {
      hit: minDist < maxDist,
      dist: minDist,
      point: hitPoint,
    };
  }

  // ─── Line of sight check ─────────────────
  hasLineOfSight(from: Vec2, to: Vec2, checkBarriers = false): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return true;

    const dir = { x: dx / dist, y: dy / dist };
    const result = this.raycast(from, dir, dist, checkBarriers);
    return !result.hit;
  }

  // ─── Ray-segment intersection ─────────────
  private raySegmentIntersect(
    origin: Vec2, dir: Vec2,
    a: Vec2, b: Vec2,
  ): number | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denom = dir.x * dy - dir.y * dx;
    if (Math.abs(denom) < 0.0001) return null;

    const t = ((a.x - origin.x) * dy - (a.y - origin.y) * dx) / denom;
    const u = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom;

    if (t >= 0 && u >= 0 && u <= 1) return t;
    return null;
  }

  // ─── Closest point on segment ─────────────
  private closestPointOnSegment(p: Vec2, seg: { ax: number; ay: number; bx: number; by: number }): Vec2 {
    const dx = seg.bx - seg.ax;
    const dy = seg.by - seg.ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) return { x: seg.ax, y: seg.ay };

    const t = Math.max(0, Math.min(1, ((p.x - seg.ax) * dx + (p.y - seg.ay) * dy) / lenSq));
    return { x: seg.ax + t * dx, y: seg.ay + t * dy };
  }
}
