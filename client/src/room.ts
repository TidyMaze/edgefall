// Spaceship interior architecture, room deck, pedestal and lighting (docs/specs/world.md section 1 & 5, issues #478, #485).
// Pure data definitions: main.ts creates the Three.js meshes and materials.

import type { Tier } from './quality';

export interface RoomSurface {
  y: number;
  width: number;
  depth: number;
  color: number;
  roughness: number;
}

// A box's size is its width, height and depth; a cylinder's its radiusTop, radiusBottom, height and radialSegments.
export type StructuralPart = {
  id: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  color: number;
  roughness: number;
} & (
  | { type: 'box'; size: readonly [number, number, number] }
  | { type: 'cylinder'; size: readonly [number, number, number, number] }
);

// The floor deck plane the board sits on: extends 64x64 to sit beneath all surrounding walls at radius 24
export const ROOM_SURFACE: RoomSurface = {
  y: -0.31,
  width: 64,
  depth: 64,
  color: 0x22272c, // Visible industrial hauler steel grating, below board steel (0x4a5258)
  roughness: 0.82,
};

// Pedestal anchoring the board into the deck floor
export function pedestalParts(): readonly StructuralPart[] {
  const parts: StructuralPart[] = [
    // Main pedestal body under the board plate
    {
      id: 'pedestal-core',
      type: 'cylinder',
      size: [3.9, 3.95, 0.22, 24], // radiusTop, radiusBottom, height, radialSegments
      position: [0, -0.42, 0],
      rotation: [0, 0, 0],
      color: 0x262c32,
      roughness: 0.8,
    },
  ];
  // 6 recessed neon light bars aligned with the 6 hexagonal sides of the board frame (apothem 4.30)
  const apothem = 4.3;
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    parts.push({
      id: `pedestal-neon-${i}`,
      type: 'box',
      size: [3.2, 0.045, 0.07],
      position: [
        Number((Math.cos(angle) * apothem).toFixed(3)),
        -0.27,
        Number((Math.sin(angle) * apothem).toFixed(3)),
      ],
      rotation: [0, Math.PI / 2 - angle, 0],
      color: 0x263840,
      roughness: 0.2,
    });
  }
  return parts;
}

// 360-degree spaceship bay enclosure surrounding the camera orbit (radius 24, well outside DIST_MAX 18)
export function spaceshipArchitecture(tier: Tier): readonly StructuralPart[] {
  const parts: StructuralPart[] = [
    ...pedestalParts(),

    // The deck's log recorder (#517, world.md section 4), flush on the SW deck: a click plays its audio log.
    {
      id: 'log-recorder',
      type: 'box',
      size: [0.6, 0.04, 0.4],
      position: [-5.2, -0.28, 3.6],
      color: 0x262c32,
      roughness: 0.8,
      rotation: [0, -Math.PI / 4, 0],
    },

    // --- BULKHEAD & GANTRY NEON TUBES (Framing the bay walls and overhead arches) ---
    {
      id: 'corner-neon-nw',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [-9.8, 3.8, -23.1],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'corner-neon-ne',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [9.8, 3.8, -23.1],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'corner-neon-sw',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [-9.8, 3.8, 23.1],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'corner-neon-se',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [9.8, 3.8, 23.1],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-column-wn',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [-23.1, 3.8, -9.8],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-column-ws',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [-23.1, 3.8, 9.8],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-column-en',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [23.1, 3.8, -9.8],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-column-es',
      type: 'box',
      size: [0.14, 7.5, 0.14],
      position: [23.1, 3.8, 9.8],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-airlock-top',
      type: 'box',
      size: [4.8, 0.12, 0.12],
      position: [0, 6.9, -23.3],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-observation-top',
      type: 'box',
      size: [7.6, 0.12, 0.12],
      position: [0, 6.4, 23.3],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-gantry-north',
      type: 'box',
      size: [16.0, 0.14, 0.14],
      position: [0, 14.2, -12.0],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },
    {
      id: 'neon-gantry-south',
      type: 'box',
      size: [16.0, 0.14, 0.14],
      position: [0, 14.2, 12.0],
      color: 0x263840,
      roughness: 0.2,
      rotation: [0, 0, 0],
    },

    // --- 360-DEGREE OCTAGONAL WALL ENCLOSURE (Radius 24) ---
    // North wall (rear bulkhead with sealed airlock)
    {
      id: 'wall-north',
      type: 'box',
      size: [22.0, 18.0, 0.4],
      position: [0, 7.5, -24.0],
      color: 0x2c333a,
      roughness: 0.85,
      rotation: [0, 0, 0],
    },
    // South wall (forward viewing bay and blast gates)
    {
      id: 'wall-south',
      type: 'box',
      size: [22.0, 18.0, 0.4],
      position: [0, 7.5, 24.0],
      color: 0x2c333a,
      roughness: 0.85,
      rotation: [0, 0, 0],
    },
    // West wall (port systems and avionics terminal bank)
    {
      id: 'wall-west',
      type: 'box',
      size: [22.0, 18.0, 0.4],
      position: [-24.0, 7.5, 0],
      color: 0x2c333a,
      roughness: 0.85,
      rotation: [0, Math.PI / 2, 0],
    },
    // East wall (starboard conduit bank and machinery)
    {
      id: 'wall-east',
      type: 'box',
      size: [22.0, 18.0, 0.4],
      position: [24.0, 7.5, 0],
      color: 0x2c333a,
      roughness: 0.85,
      rotation: [0, Math.PI / 2, 0],
    },

    // Diagonal corner bulkheads (radius hypot(17, 17) = 24.04)
    {
      id: 'wall-diagonal-nw',
      type: 'box',
      size: [14.0, 18.0, 0.4],
      position: [-17.0, 7.5, -17.0],
      color: 0x2a3138,
      roughness: 0.86,
      rotation: [0, Math.PI / 4, 0],
    },
    {
      id: 'wall-diagonal-ne',
      type: 'box',
      size: [14.0, 18.0, 0.4],
      position: [17.0, 7.5, -17.0],
      color: 0x2a3138,
      roughness: 0.86,
      rotation: [0, -Math.PI / 4, 0],
    },
    {
      id: 'wall-diagonal-sw',
      type: 'box',
      size: [14.0, 18.0, 0.4],
      position: [-17.0, 7.5, 17.0],
      color: 0x2a3138,
      roughness: 0.86,
      rotation: [0, -Math.PI / 4, 0],
    },
    {
      id: 'wall-diagonal-se',
      type: 'box',
      size: [14.0, 18.0, 0.4],
      position: [17.0, 7.5, 17.0],
      color: 0x2a3138,
      roughness: 0.86,
      rotation: [0, Math.PI / 4, 0],
    },

    // --- STRUCTURAL CORNER BULKHEAD COLUMNS (Radius ~23.5) ---
    {
      id: 'bulkhead-column-nw-a',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [-10.5, 7.5, -23.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-column-ne-a',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [10.5, 7.5, -23.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-column-sw-a',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [-10.5, 7.5, 23.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-column-se-a',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [10.5, 7.5, 23.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-column-wn-b',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [-23.5, 7.5, -10.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-column-ws-b',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [-23.5, 7.5, 10.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-column-en-b',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [23.5, 7.5, -10.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-column-es-b',
      type: 'box',
      size: [1.2, 18.2, 1.2],
      position: [23.5, 7.5, 10.5],
      color: 0x343c44,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },

    // --- CEILING PERIMETER BEAMS (At y = 16.0, above camera) ---
    {
      id: 'beam-perimeter-north',
      type: 'box',
      size: [22.0, 1.0, 1.0],
      position: [0, 16.0, -23.5],
      color: 0x2e363e,
      roughness: 0.82,
      rotation: [0, 0, 0],
    },
    {
      id: 'beam-perimeter-south',
      type: 'box',
      size: [22.0, 1.0, 1.0],
      position: [0, 16.0, 23.5],
      color: 0x2e363e,
      roughness: 0.82,
      rotation: [0, 0, 0],
    },
    {
      id: 'beam-perimeter-west',
      type: 'box',
      size: [1.0, 1.0, 22.0],
      position: [-23.5, 16.0, 0],
      color: 0x2e363e,
      roughness: 0.82,
      rotation: [0, 0, 0],
    },
    {
      id: 'beam-perimeter-east',
      type: 'box',
      size: [1.0, 1.0, 22.0],
      position: [23.5, 16.0, 0],
      color: 0x2e363e,
      roughness: 0.82,
      rotation: [0, 0, 0],
    },

    // --- DIEGETIC AIRLOCK (North wall at z = -23.7) ---
    {
      id: 'airlock-frame',
      type: 'box',
      size: [5.0, 7.0, 0.4],
      position: [0, 3.5, -23.7],
      color: 0x3a424a,
      roughness: 0.75,
      rotation: [0, 0, 0],
    },
    {
      id: 'airlock-door',
      type: 'box',
      size: [4.2, 6.2, 0.2],
      position: [0, 3.5, -23.85],
      color: 0x282e34,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },

    // --- AIRLOCK FLANKING HYDRAULIC RAMS ---
    {
      id: 'airlock-ram-left',
      type: 'cylinder',
      size: [0.18, 0.18, 5.0, 8],
      position: [-3.8, 3.2, -23.5],
      color: 0x2e353c,
      roughness: 0.75,
      rotation: [0, 0, 0],
    },
    {
      id: 'airlock-ram-right',
      type: 'cylinder',
      size: [0.18, 0.18, 5.0, 8],
      position: [3.8, 3.2, -23.5],
      color: 0x2e353c,
      roughness: 0.75,
      rotation: [0, 0, 0],
    },

    // --- OVERHEAD BULKHEAD ARCH RIBS (Framing ceiling at radius 22.0) ---
    {
      id: 'bulkhead-arch-north',
      type: 'box',
      size: [20.0, 1.2, 0.8],
      position: [0, 15.0, -22.0],
      color: 0x323a42,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },
    {
      id: 'bulkhead-arch-south',
      type: 'box',
      size: [20.0, 1.2, 0.8],
      position: [0, 15.0, 22.0],
      color: 0x323a42,
      roughness: 0.8,
      rotation: [0, 0, 0],
    },

    // --- DIEGETIC OBSERVATION / FORWARD BAY (South wall at z = 23.7) ---
    {
      id: 'observation-frame',
      type: 'box',
      size: [8.0, 5.0, 0.4],
      position: [0, 4.0, 23.7],
      color: 0x343c44,
      roughness: 0.78,
      rotation: [0, 0, 0],
    },
    {
      id: 'observation-glass',
      type: 'box',
      size: [7.2, 4.2, 0.2],
      position: [0, 4.0, 23.85],
      color: 0x1b2830, // Cool tinted reinforced space glass
      roughness: 0.4,
      rotation: [0, 0, 0],
    },

    // --- DIEGETIC TERMINAL CONSOLE (Module 3B Bolted Kiosk Stand & Screen) ---
    {
      id: 'console-desk',
      type: 'box',
      size: [1.6, 2.4, 2.4],
      position: [-11.8, 1.2, -6.2],
      color: 0x30373e,
      roughness: 0.75,
      rotation: [0, 0, 0],
    },
    {
      id: 'console-screen',
      type: 'box',
      size: [0.1, 1.4, 2.8],
      position: [-11.36, 2.32, -6.2],
      color: 0x182e28, // Phosphor screen hue
      roughness: 0.5,
      rotation: [0, 0, 0],
    },

    // --- STARBOARD CONDUIT STACK (East wall at x = 23.4) ---
    {
      id: 'machinery-stack-main',
      type: 'cylinder',
      size: [0.35, 0.35, 14.0, 10],
      position: [23.4, 7.0, 0],
      color: 0x323a42,
      roughness: 0.78,
      rotation: [0, 0, 0],
    },
  ];

  // High tier gets fine architectural details (hazard lintels and overhead conduit manifolds)
  if (tier !== 'low') {
    parts.push(
      // Hazard warning lintel strip directly above airlock frame
      {
        id: 'hazard-lintel',
        type: 'box',
        size: [5.0, 0.5, 0.08],
        position: [0, 7.25, -23.65],
        color: 0x483a24, // Amber hazard steel
        roughness: 0.6,
        rotation: [0, 0, 0],
      },
      // Hazard strip on South observation deck threshold
      {
        id: 'hazard-lintel-south',
        type: 'box',
        size: [8.0, 0.4, 0.08],
        position: [0, 6.7, 23.65],
        color: 0x483a24,
        roughness: 0.6,
        rotation: [0, 0, 0],
      },
      // Starboard high-pressure conduit distribution manifold
      {
        id: 'conduit-manifold-ne',
        type: 'cylinder',
        size: [0.28, 0.28, 3.2, 8],
        position: [14.0, 6.0, -21.0],
        color: 0x283038,
        roughness: 0.82,
        rotation: [Math.PI / 2, 0, 0],
      },
    );
  }

  return parts;
}

/** The two colours of the neon tubes: the deck's emergency sodium for the airlock and the far ones, the cold cyan for the rest. */
export interface SpaceshipLights {
  emergency: number;
  rim: number;
}

export function spaceshipLights(deck?: string): SpaceshipLights {
  const emergency = { furnace: 0xff4d00, bridge: 0x00cec9, chapel: 0x6c5ce7, cargo: 0x7fd6e8 }[deck as string] ?? 0xd9822b;
  return { emergency, rim: 0x7fd6e8 };
}

export const propList = spaceshipArchitecture;
