import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * TokenConfetti - An EPIC celebration effect with token logos
 * Features:
 * - Initial explosion burst with screen flash
 * - Sustained confetti rain of spinning token logos
 * - Golden sparkle/glitter particles throughout
 * - Firework bursts
 * - Trail effects
 * - Canvas-based for smooth 60fps with hundreds of particles
 */
const TokenConfetti = ({ 
    tokenLogos = [], 
    trigger = 0, 
    duration = 8000, 
    particleCount = 100 
}) => {
    const canvasRef = useRef(null);
    const [isActive, setIsActive] = useState(false);
    const [loadedImages, setLoadedImages] = useState([]);
    const [screenFlash, setScreenFlash] = useState(false);
    const animationRef = useRef(null);
    const particlesRef = useRef([]);
    const sparklesRef = useRef([]);
    const fireworksRef = useRef([]);
    const startTimeRef = useRef(null);
    const lastTriggerRef = useRef(0);
    
    // Preload all images
    useEffect(() => {
        if (tokenLogos.length === 0) return;
        
        const loadImage = (url) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = url;
            });
        };
        
        Promise.all(tokenLogos.map(loadImage)).then(results => {
            const loaded = results.filter(img => img !== null);
            setLoadedImages(loaded);
        });
    }, [tokenLogos]);
    
    // Create sparkle particle
    const createSparkle = useCallback((x, y, isExplosion = false) => {
        const angle = Math.random() * Math.PI * 2;
        const speed = isExplosion ? 8 + Math.random() * 15 : 2 + Math.random() * 4;
        const colors = ['#FFD700', '#FFA500', '#FFEC8B', '#FFFACD', '#FFE4B5', '#FFFFFF', '#F0E68C'];
        
        return {
            x,
            y,
            vx: Math.cos(angle) * speed * (isExplosion ? 1 : 0.3),
            vy: Math.sin(angle) * speed * (isExplosion ? 1 : 0.5) - (isExplosion ? 5 : 1),
            size: 2 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 1,
            decay: 0.015 + Math.random() * 0.02,
            gravity: 0.1,
            twinkle: Math.random() * Math.PI * 2,
            twinkleSpeed: 0.1 + Math.random() * 0.2
        };
    }, []);
    
    // Create firework burst
    const createFireworkBurst = useCallback((x, y) => {
        const particles = [];
        const particleCount = 30 + Math.floor(Math.random() * 20);
        const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
        const burstColor = colors[Math.floor(Math.random() * colors.length)];
        
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const speed = 4 + Math.random() * 8;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 3 + Math.random() * 3,
                color: burstColor,
                alpha: 1,
                decay: 0.02 + Math.random() * 0.015,
                gravity: 0.15,
                trail: []
            });
        }
        return particles;
    }, []);
    
    // Create token confetti particle
    const createConfetti = useCallback((images, isInitialBurst = false) => {
        const img = images[Math.floor(Math.random() * images.length)];
        const size = 30 + Math.random() * 50;
        const x = isInitialBurst 
            ? window.innerWidth / 2 + (Math.random() - 0.5) * 200
            : Math.random() * window.innerWidth;
        const y = isInitialBurst 
            ? window.innerHeight / 2
            : -size - Math.random() * 500;
        
        const angle = isInitialBurst ? Math.random() * Math.PI * 2 : 0;
        const speed = isInitialBurst ? 10 + Math.random() * 15 : 0;
        
        return {
            img,
            x,
            y,
            vx: isInitialBurst ? Math.cos(angle) * speed : (Math.random() - 0.5) * 2,
            vy: isInitialBurst ? Math.sin(angle) * speed - 5 : 2 + Math.random() * 3,
            size,
            rotation: Math.random() * 360,
            rotationSpeed: (Math.random() - 0.5) * 15,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.02 + Math.random() * 0.03,
            wobbleAmp: 30 + Math.random() * 50,
            baseX: x,
            alpha: 1,
            gravity: 0.12,
            airResistance: 0.99,
            glowIntensity: 0.5 + Math.random() * 0.5
        };
    }, []);
    
    // Initialize effect when triggered
    useEffect(() => {
        if (trigger === 0 || trigger === lastTriggerRef.current || loadedImages.length === 0) return;
        lastTriggerRef.current = trigger;
        
        console.log('🎉 TRIGGERING EPIC CONFETTI!', { imageCount: loadedImages.length });
        
        // Screen flash
        setScreenFlash(true);
        setTimeout(() => setScreenFlash(false), 150);
        
        // Initial burst of confetti from center
        const burstConfetti = [];
        for (let i = 0; i < 40; i++) {
            burstConfetti.push(createConfetti(loadedImages, true));
        }
        
        // Rain confetti
        const rainConfetti = [];
        for (let i = 0; i < particleCount; i++) {
            const p = createConfetti(loadedImages, false);
            p.delay = Math.random() * 3000; // Stagger the rain
            rainConfetti.push(p);
        }
        
        particlesRef.current = [...burstConfetti, ...rainConfetti];
        
        // Initial sparkle explosion
        const initialSparkles = [];
        for (let i = 0; i < 150; i++) {
            initialSparkles.push(createSparkle(
                window.innerWidth / 2 + (Math.random() - 0.5) * 100,
                window.innerHeight / 2 + (Math.random() - 0.5) * 100,
                true
            ));
        }
        sparklesRef.current = initialSparkles;
        
        // Schedule firework bursts
        fireworksRef.current = [];
        const fireworkTimes = [500, 1200, 2000, 2800, 3500, 4500];
        fireworkTimes.forEach(time => {
            setTimeout(() => {
                if (animationRef.current) {
                    const x = 100 + Math.random() * (window.innerWidth - 200);
                    const y = 100 + Math.random() * (window.innerHeight / 2);
                    fireworksRef.current.push(...createFireworkBurst(x, y));
                }
            }, time);
        });
        
        setIsActive(true);
        startTimeRef.current = performance.now();
        
    }, [trigger, loadedImages, particleCount, createConfetti, createSparkle, createFireworkBurst]);
    
    // Main animation loop
    useEffect(() => {
        if (!isActive) return;
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        const animate = (currentTime) => {
            const elapsed = currentTime - startTimeRef.current;
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Add ambient sparkles throughout
            if (Math.random() < 0.3 && elapsed < duration - 1000) {
                sparklesRef.current.push(createSparkle(
                    Math.random() * window.innerWidth,
                    Math.random() * window.innerHeight * 0.7,
                    false
                ));
            }
            
            // Update and draw sparkles
            sparklesRef.current = sparklesRef.current.filter(s => {
                s.x += s.vx;
                s.y += s.vy;
                s.vy += s.gravity;
                s.alpha -= s.decay;
                s.twinkle += s.twinkleSpeed;
                
                if (s.alpha <= 0) return false;
                
                const twinkleAlpha = s.alpha * (0.5 + 0.5 * Math.sin(s.twinkle));
                
                // Draw sparkle with glow
                ctx.save();
                ctx.globalAlpha = twinkleAlpha;
                ctx.shadowBlur = 15;
                ctx.shadowColor = s.color;
                ctx.fillStyle = s.color;
                ctx.beginPath();
                
                // Star shape
                const spikes = 4;
                const outerRadius = s.size;
                const innerRadius = s.size * 0.4;
                for (let i = 0; i < spikes * 2; i++) {
                    const radius = i % 2 === 0 ? outerRadius : innerRadius;
                    const angle = (i * Math.PI) / spikes - Math.PI / 2;
                    if (i === 0) {
                        ctx.moveTo(s.x + radius * Math.cos(angle), s.y + radius * Math.sin(angle));
                    } else {
                        ctx.lineTo(s.x + radius * Math.cos(angle), s.y + radius * Math.sin(angle));
                    }
                }
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                
                return true;
            });
            
            // Update and draw fireworks
            fireworksRef.current = fireworksRef.current.filter(p => {
                // Store trail
                p.trail.push({ x: p.x, y: p.y, alpha: p.alpha });
                if (p.trail.length > 8) p.trail.shift();
                
                p.x += p.vx;
                p.y += p.vy;
                p.vy += p.gravity;
                p.vx *= 0.98;
                p.alpha -= p.decay;
                
                if (p.alpha <= 0) return false;
                
                // Draw trail
                ctx.save();
                p.trail.forEach((t, i) => {
                    const trailAlpha = (i / p.trail.length) * p.alpha * 0.5;
                    ctx.globalAlpha = trailAlpha;
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(t.x, t.y, p.size * (i / p.trail.length), 0, Math.PI * 2);
                    ctx.fill();
                });
                
                // Draw particle with glow
                ctx.globalAlpha = p.alpha;
                ctx.shadowBlur = 20;
                ctx.shadowColor = p.color;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                
                return true;
            });
            
            // Update and draw confetti
            particlesRef.current = particlesRef.current.filter(p => {
                // Check delay
                if (p.delay && elapsed < p.delay) {
                    // Draw nothing yet, but keep particle
                    return true;
                }
                
                // Physics
                p.vy += p.gravity;
                p.vx *= p.airResistance;
                p.vy *= p.airResistance;
                
                // Wobble
                p.wobble += p.wobbleSpeed;
                const wobbleOffset = Math.sin(p.wobble) * p.wobbleAmp;
                
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotationSpeed;
                
                // Fade out
                if (elapsed > duration - 2000) {
                    p.alpha = Math.max(0, (duration - elapsed) / 2000);
                }
                if (p.y > window.innerHeight + 100) {
                    p.alpha -= 0.05;
                }
                
                if (p.alpha <= 0) return false;
                
                const drawX = p.baseX !== undefined ? p.baseX + wobbleOffset + (p.x - p.baseX) : p.x;
                const drawY = p.y;
                
                // Draw token logo with effects
                ctx.save();
                ctx.translate(drawX, drawY);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = p.alpha;
                
                // Outer glow
                ctx.shadowBlur = 25 * p.glowIntensity;
                ctx.shadowColor = `rgba(255, 215, 0, ${0.8 * p.alpha})`;
                
                // Draw circular clip for logo
                ctx.beginPath();
                ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                
                // Draw the image
                ctx.drawImage(
                    p.img,
                    -p.size / 2,
                    -p.size / 2,
                    p.size,
                    p.size
                );
                
                ctx.restore();
                
                // Draw golden ring around logo
                ctx.save();
                ctx.translate(drawX, drawY);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = p.alpha * 0.8;
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 3;
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#FFD700';
                ctx.beginPath();
                ctx.arc(0, 0, p.size / 2 + 2, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                
                return true;
            });
            
            // Continue animation
            if (elapsed < duration + 1000 && (particlesRef.current.length > 0 || sparklesRef.current.length > 0 || fireworksRef.current.length > 0)) {
                animationRef.current = requestAnimationFrame(animate);
            } else {
                setIsActive(false);
            }
        };
        
        animationRef.current = requestAnimationFrame(animate);
        
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [isActive, duration, createSparkle]);
    
    // Handle window resize
    useEffect(() => {
        if (!isActive) return;
        
        const handleResize = () => {
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }
        };
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isActive]);
    
    if (!isActive && !screenFlash) return null;
    
    return createPortal(
        <>
            {/* Screen flash effect */}
            {screenFlash && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        background: 'radial-gradient(circle at center, rgba(255,215,0,0.4) 0%, rgba(255,165,0,0.2) 50%, transparent 100%)',
                        zIndex: 10001,
                        pointerEvents: 'none',
                        animation: 'flashPulse 150ms ease-out'
                    }}
                />
            )}
            
            {/* Ambient glow overlay */}
            {isActive && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        background: 'radial-gradient(ellipse at 50% 30%, rgba(255,215,0,0.08) 0%, transparent 60%)',
                        zIndex: 9998,
                        pointerEvents: 'none'
                    }}
                />
            )}
            
            {/* Main canvas */}
            <canvas
                ref={canvasRef}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    pointerEvents: 'none',
                    zIndex: 10000
                }}
            />
            
            {/* CSS for animations */}
            <style>{`
                @keyframes flashPulse {
                    0% { opacity: 0; transform: scale(0.8); }
                    50% { opacity: 1; transform: scale(1.1); }
                    100% { opacity: 0; transform: scale(1.2); }
                }
            `}</style>
        </>,
        document.body
    );
};

export default TokenConfetti;
