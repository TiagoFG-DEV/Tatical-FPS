export function parseGridMap(id: string, name: string, tileSize: number, gridStr: string): any {
  const lines = gridStr.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const rows = lines.length;
  const cols = lines[0].length;
  const width = cols * tileSize;
  const height = rows * tileSize;

  const walls: any[] = [];
  const zones: any[] = [];
  const spawnPoints = { attackers: [] as any[], defenders: [] as any[] };

  const getTile = (c: number, r: number) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return '#';
    return lines[r][c];
  };

  // Build walls by checking exposed edges
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = getTile(c, r);
      if (tile === '#') {
        const x = c * tileSize;
        const y = r * tileSize;
        
        // Top edge
        if (getTile(c, r - 1) !== '#') walls.push({ x1: x, y1: y, x2: x + tileSize, y2: y });
        // Bottom edge
        if (getTile(c, r + 1) !== '#') walls.push({ x1: x, y1: y + tileSize, x2: x + tileSize, y2: y + tileSize });
        // Left edge
        if (getTile(c - 1, r) !== '#') walls.push({ x1: x, y1: y, x2: x, y2: y + tileSize });
        // Right edge
        if (getTile(c + 1, r) !== '#') walls.push({ x1: x + tileSize, y1: y, x2: x + tileSize, y2: y + tileSize });
      }
    }
  }

  // Build zones & spawns by grouping adjacent same-type tiles (simple greedy approach or just per-tile)
  // For simplicity, we can just create a zone per tile, but that's bad for performance.
  // Instead, just define bounding boxes manually or do a simple row-merging.
  // Actually, we can just do row-merging for zones:
  for (let r = 0; r < rows; r++) {
    let startC = -1;
    let currentType = '';
    
    for (let c = 0; c <= cols; c++) {
      const tile = c < cols ? getTile(c, r) : '';
      const isZone = 'AD12MB'.includes(tile);
      
      if (isZone && tile === currentType) {
        if (startC === -1) startC = c;
      } else {
        if (startC !== -1) {
          // Finish current zone
          const zType = 
            currentType === 'A' ? 'attacker_spawn' :
            currentType === 'D' ? 'defender_spawn' :
            currentType === '1' ? 'site_a' :
            currentType === '2' ? 'site_b' : 
            currentType === 'B' ? 'barrier' : 'mid';
            
          zones.push({
            id: `${zType}_${r}_${startC}`,
            label: zType === 'barrier' ? '' : zType.toUpperCase(),
            type: zType,
            polygon: [
              { x: startC * tileSize, y: r * tileSize },
              { x: c * tileSize, y: r * tileSize },
              { x: c * tileSize, y: (r + 1) * tileSize },
              { x: startC * tileSize, y: (r + 1) * tileSize },
            ],
            surface: (currentType === '1' || currentType === '2') ? 'metal' : (currentType === 'M' ? 'stone' : 'default')
          });
          
          // Add spawns
          if (currentType === 'A') spawnPoints.attackers.push({ x: (startC + c) / 2 * tileSize, y: (r + 0.5) * tileSize });
          if (currentType === 'D') spawnPoints.defenders.push({ x: (startC + c) / 2 * tileSize, y: (r + 0.5) * tileSize });
          
          startC = -1;
        }
        if (isZone) {
          startC = c;
          currentType = tile;
        }
      }
    }
  }

  // Optimize walls: merge collinear adjacent walls
  // ... (for now, keeping them per-tile is fine, but merging is better for raycasting performance).
  const mergedWalls: any[] = [];
  
  // Merge horizontal
  const hWalls = walls.filter(w => w.y1 === w.y2).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  for (const w of hWalls) {
    const last = mergedWalls[mergedWalls.length - 1];
    if (last && last.y1 === w.y1 && last.y2 === w.y2 && last.x2 === w.x1) {
      last.x2 = w.x2; // extend
    } else {
      mergedWalls.push({ ...w });
    }
  }
  
  // Merge vertical
  const vWalls = walls.filter(w => w.x1 === w.x2).sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1);
  for (const w of vWalls) {
    const last = mergedWalls[mergedWalls.length - 1];
    if (last && last.x1 === w.x1 && last.x2 === w.x2 && last.y2 === w.y1) {
      last.y2 = w.y2; // extend
    } else {
      mergedWalls.push({ ...w });
    }
  }

  return {
    id, name, width, height, walls: mergedWalls, zones, spawnPoints
  };
}
