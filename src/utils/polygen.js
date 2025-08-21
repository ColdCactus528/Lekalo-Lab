export const randInt = (a, b) => a + Math.floor(Math.random() * (b - a +1));

function normalizePolygon(pts, svgWidth = 120, svgHeight = 90, padding = 4) {
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const polyWidth = maxX - minX;
  const polyHeight = maxY - minY;

  const scaleX = (svgWidth - 2*padding) / (polyWidth || 1);
  const scaleY = (svgHeight - 2*padding) / (polyHeight || 1);
  const scale = Math.min(scaleX, scaleY);

  const offsetX = padding - minX*scale;
  const offsetY = padding - minY*scale;

  return pts.map(p => ({
    x: p.x*scale + offsetX,
    y: p.y*scale + offsetY
  }));
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p1, p2, p3) =>
    (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);

  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c ,d, b);

  return (d1 * d2 < 0) && (d3 * d4 < 0);
}

function isSimplePolygon(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const b1 = pts[(i+1)%n];
    for (let j = i+1; j < n; j++) {
      if (Math.abs(i-j) <= 1 || (i===0 && j===n-1) || (i===n-1 && j===0)) continue;
      const a2 = pts[j];
      const b2 = pts[(j+1)%n];
      if (segmentsIntersect(a1, b1, a2, b2)) return false;
    }
  }
  return true;
}

function isConvexPolygon(pts) {
  const n = pts.length;
  if (n < 3) return false;
  let sign = 0;

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];

    const cross = (b.x - a.x)*(c.y - b.y) - (b.y - a.y)*(c.x - b.x);

    if (Math.abs(cross) > 1e-8) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }

  console.log('gh');
  return true;
}

function isAngleEnough(pts, minAngleDeg = 15) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];

    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };

    const cosAngle = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    const angleDeg = Math.acos(Math.min(Math.max(cosAngle, -1), 1)) * 180 / Math.PI;

    if (angleDeg < minAngleDeg) return false;
  }
  return true;
}

function isDistanceEnough(pts, dMin = 25) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < dMin) return false;
  }
  return true;
}

export function makePolySimple() {
  const n = randInt(3, 8);
  const rMin = 25, rMax = 50;
  let pts;

  do {
    const angles = Array.from({length:n}, () => Math.random() * 2*Math.PI).sort((a,b)=>a-b);
    pts = angles.map(t => {
      const r = rMin + Math.random()*(rMax - rMin);
      return {
        x: r * Math.cos(t),
        y: r * Math.sin(t)
      };
    });
  } while (
    !isSimplePolygon(pts) ||
    !isAngleEnough(pts) ||
    !isDistanceEnough(pts)
  );

  pts = normalizePolygon(pts, 120, 90, 8);

  const h = randInt(0,360);
  return {
    id: `p_${crypto.randomUUID ?.() || Date.now() + ' ' + Math.random()}`,
    points: pts,
    fill: `hsl(${h} 70% 55%)`,
    stroke: 'rgba(0,0,0.25)'
  };
} 

export function makePolyConvex() {
  let pts;
  const n = randInt(3, 8);
  const rMin = 25, rMax = 45;
  const r = (rMin + rMax)/2;

  do {
    pts = [];
    let angleStep = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      const angle = i * angleStep + (Math.random() - 0.5) * angleStep * 0.5;
      const r = rMin + Math.random() * (rMax - rMin) * 0.25;
      pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
    }
  } while (!isConvexPolygon(pts) || !isSimplePolygon(pts));

  pts = normalizePolygon(pts, 120, 90, 8);

  const h = randInt(0, 360);

  return {
    id: `p_${crypto.randomUUID ?.() || Date.now() + ' ' + Math.random()}`,
    points: pts,
    fill: `hsl(${h} 70% 55%)`,
    stroke: 'rgba(0,0,0.25)'
  };
} 

export function makeManySimple() {
  return Array.from({ length: randInt(5, 20) }, makePolySimple);
}

export function makeManyConvex() {
  return Array.from({ length: randInt(5, 20) }, makePolyConvex);
}