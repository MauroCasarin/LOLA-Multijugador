import React, { useRef, useEffect, useCallback } from 'react';

interface JoystickProps {
  onChange: (data: { x: number; y: number }) => void;
}

export default function Joystick({ onChange }: JoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const touchId = useRef<number | null>(null);

  const updatePosition = useCallback((clientX: number, clientY: number) => {
    if (!active.current || !baseRef.current || !stickRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2;

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }

    stickRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // Invert Y so UP is positive
    onChange({ x: dx / maxRadius, y: -dy / maxRadius });
  }, [onChange]);

  const handleStart = useCallback((clientX: number, clientY: number, id: number | null = null) => {
    active.current = true;
    touchId.current = id;
    if (stickRef.current) {
      stickRef.current.style.transition = 'none';
    }
    updatePosition(clientX, clientY);
  }, [updatePosition]);

  const handleEnd = useCallback(() => {
    active.current = false;
    touchId.current = null;
    if (stickRef.current) {
      stickRef.current.style.transition = 'transform 0.15s ease-out';
      stickRef.current.style.transform = `translate(-50%, -50%)`;
    }
    onChange({ x: 0, y: 0 });
  }, [onChange]);

  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      if (active.current && touchId.current !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === touchId.current) {
            e.preventDefault(); // Prevent scrolling while using joystick
            updatePosition(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
            break;
          }
        }
      }
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (active.current && touchId.current === null) {
        updatePosition(e.clientX, e.clientY);
      }
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (active.current && touchId.current !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === touchId.current) {
            handleEnd();
            break;
          }
        }
      }
    };
    const handleMouseUp = () => {
      if (active.current && touchId.current === null) {
        handleEnd();
      }
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updatePosition, handleEnd]);

  return (
    <div
      ref={baseRef}
      className="relative w-32 h-32 bg-white/10 backdrop-blur-md border-2 border-white/20 rounded-full touch-none select-none shadow-xl"
      onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
      onTouchStart={(e) => {
        if (!active.current) {
          const touch = e.changedTouches[0];
          handleStart(touch.clientX, touch.clientY, touch.identifier);
        }
      }}
    >
      <div
        ref={stickRef}
        className="absolute top-1/2 left-1/2 w-12 h-12 bg-white/80 rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      />
    </div>
  );
}
