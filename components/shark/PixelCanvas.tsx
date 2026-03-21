"use client";

import { useEffect, useRef } from "react";

interface PixelCanvasProps {
  frame: string[];
  palette: Record<string, string>;
  scale?: number;
  className?: string;
}

export function PixelCanvas({ frame, palette, scale = 6, className }: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = frame[0]?.length ?? 16;
  const height = frame.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width * scale, height * scale);

    for (let y = 0; y < height; y++) {
      const row = frame[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const key = row[x];
        if (key === "_" || !key) continue;
        const color = palette[key];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }, [frame, palette, scale, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width * scale}
      height={height * scale}
      className={className}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
