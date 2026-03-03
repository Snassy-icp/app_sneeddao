import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGame } from '../game/outrun/engine.js';
import { createInput } from '../game/outrun/input.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../game/outrun/constants.js';
import { ALL_TRACKS, DEFAULT_TRACK } from '../game/outrun/tracks.js';
import './OutRun.css';

export default function OutRun() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const containerRef = useRef(null);

  const cleanup = useCallback(() => {
    if (gameRef.current) {
      gameRef.current.stop();
      gameRef.current = null;
    }
    if (inputRef.current) {
      inputRef.current.detach();
      inputRef.current = null;
    }
  }, []);

  const initGame = useCallback((trackIndex) => {
    cleanup();

    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    const track = ALL_TRACKS[trackIndex] || DEFAULT_TRACK;

    try {
      const game = createGame(canvas, track);
      const input = createInput();

      gameRef.current = game;
      inputRef.current = input;

      input.attach();
      game.start(input);
    } catch (e) {
      console.error('OutRun: failed to initialize game', e);
    }
  }, [cleanup]);

  useEffect(() => {
    initGame(selectedTrack);
    return cleanup;
  }, [selectedTrack, initGame, cleanup]);

  useEffect(() => {
    function onEsc(e) {
      if (e.code === 'Escape') {
        if (document.fullscreenElement) {
          exitFullscreen();
        } else {
          navigate('/');
        }
      }
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [navigate]);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      exitFullscreen();
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    const rfs = el.requestFullscreen
      || el.webkitRequestFullscreen
      || el.mozRequestFullScreen
      || el.msRequestFullscreen;

    if (rfs) {
      rfs.call(el).then(() => setIsFullscreen(true)).catch((err) => {
        console.warn('Fullscreen request denied:', err);
      });
    }
  }

  function exitFullscreen() {
    const efs = document.exitFullscreen
      || document.webkitExitFullscreen
      || document.mozCancelFullScreen
      || document.msExitFullscreen;

    if (efs && document.fullscreenElement) {
      efs.call(document).then(() => setIsFullscreen(false)).catch(() => {});
    }
    setIsFullscreen(false);
  }

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const handleTouchStart = useCallback((zone) => (e) => {
    e.preventDefault();
    if (!inputRef.current) return;
    switch (zone) {
      case 'left':
        inputRef.current.setTouch(-1, false, false);
        inputRef.current.state.left = true;
        break;
      case 'right':
        inputRef.current.setTouch(1, false, false);
        inputRef.current.state.right = true;
        break;
      case 'gas':
        inputRef.current.state.up = true;
        break;
      case 'brake':
        inputRef.current.state.down = true;
        break;
    }
  }, []);

  const handleTouchEnd = useCallback((zone) => (e) => {
    e.preventDefault();
    if (!inputRef.current) return;
    switch (zone) {
      case 'left':
        inputRef.current.setTouch(0, false, false);
        inputRef.current.state.left = false;
        break;
      case 'right':
        inputRef.current.setTouch(0, false, false);
        inputRef.current.state.right = false;
        break;
      case 'gas':
        inputRef.current.state.up = false;
        break;
      case 'brake':
        inputRef.current.state.down = false;
        break;
    }
  }, []);

  return (
    <div className="outrun-page" ref={containerRef}>
      <div className="outrun-header">
        <button className="outrun-back-btn" onClick={() => navigate('/')}>
          &larr; Back
        </button>
        <div className="outrun-track-select">
          {ALL_TRACKS.map((t, i) => (
            <button
              key={t.name}
              className={`outrun-track-btn ${i === selectedTrack ? 'active' : ''}`}
              onClick={() => setSelectedTrack(i)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <button className="outrun-fs-btn" onClick={toggleFullscreen}>
          {isFullscreen ? '\u229E' : '\u229E'} Fullscreen
        </button>
      </div>

      <div className="outrun-canvas-wrapper">
        <canvas ref={canvasRef} className="outrun-canvas" />
        <div className="outrun-scanlines" />
      </div>

      <div className="outrun-touch-controls">
        <div
          className="touch-zone touch-left"
          onTouchStart={handleTouchStart('left')}
          onTouchEnd={handleTouchEnd('left')}
        >
          &larr;
        </div>
        <div className="touch-zone-center">
          <div
            className="touch-zone touch-gas"
            onTouchStart={handleTouchStart('gas')}
            onTouchEnd={handleTouchEnd('gas')}
          >
            GAS
          </div>
          <div
            className="touch-zone touch-brake"
            onTouchStart={handleTouchStart('brake')}
            onTouchEnd={handleTouchEnd('brake')}
          >
            BRK
          </div>
          <div
            className="touch-zone touch-start"
            onTouchStart={() => { if (inputRef.current) inputRef.current.state.start = true; }}
            onTouchEnd={() => { if (inputRef.current) inputRef.current.state.start = false; }}
          >
            START
          </div>
        </div>
        <div
          className="touch-zone touch-right"
          onTouchStart={handleTouchStart('right')}
          onTouchEnd={handleTouchEnd('right')}
        >
          &rarr;
        </div>
      </div>
    </div>
  );
}
