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
 * - Scales intensity based on USD value
 * - Spectacular USD amount splash display
 */
const TokenConfetti = ({ 
    tokenLogos = [], 
    trigger = 0, 
    duration = 8000, 
    particleCount = 100,
    usdValue = 0 // USD value of new tips for scaling and display
}) => {
    const canvasRef = useRef(null);
    const [isActive, setIsActive] = useState(false);
    const [loadedImages, setLoadedImages] = useState([]);
    const [screenFlash, setScreenFlash] = useState(false);
    const [showUsdSplash, setShowUsdSplash] = useState(false);
    const [displayedUsdValue, setDisplayedUsdValue] = useState(0);
    const animationRef = useRef(null);
    const particlesRef = useRef([]);
    const sparklesRef = useRef([]);
    const fireworksRef = useRef([]);
    const startTimeRef = useRef(null);
    const lastTriggerRef = useRef(0);
    
    // Calculate intensity multiplier (0.5 to 1.0 based on USD value)
    // $0 = 50%, $1+ = 100%, linear scale between
    const getIntensityMultiplier = useCallback((value) => {
        if (value >= 1) return 1;
        if (value <= 0) return 0.5;
        return 0.5 + (value * 0.5); // Linear interpolation from 0.5 to 1.0
    }, []);
    
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
    const createSparkle = useCallback((x, y, isExplosion = false, intensity = 1) => {
        const angle = Math.random() * Math.PI * 2;
        const speed = isExplosion ? (8 + Math.random() * 15) * intensity : (2 + Math.random() * 4) * intensity;
        const colors = ['#FFD700', '#FFA500', '#FFEC8B', '#FFFACD', '#FFE4B5', '#FFFFFF', '#F0E68C'];
        
        return {
            x,
            y,
            vx: Math.cos(angle) * speed * (isExplosion ? 1 : 0.3),
            vy: Math.sin(angle) * speed * (isExplosion ? 1 : 0.5) - (isExplosion ? 5 : 1),
            size: (2 + Math.random() * 4) * intensity,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 1,
            decay: 0.015 + Math.random() * 0.02,
            gravity: 0.1,
            twinkle: Math.random() * Math.PI * 2,
            twinkleSpeed: 0.1 + Math.random() * 0.2
        };
    }, []);
    
    // Create firework burst
    const createFireworkBurst = useCallback((x, y, intensity = 1) => {
        const particles = [];
        const burstParticleCount = Math.floor((30 + Math.floor(Math.random() * 20)) * intensity);
        const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
        const burstColor = colors[Math.floor(Math.random() * colors.length)];
        
        for (let i = 0; i < burstParticleCount; i++) {
            const angle = (i / burstParticleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const speed = (4 + Math.random() * 8) * intensity;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: (3 + Math.random() * 3) * intensity,
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
    const createConfetti = useCallback((images, isInitialBurst = false, intensity = 1) => {
        const img = images[Math.floor(Math.random() * images.length)];
        const size = (30 + Math.random() * 50) * intensity;
        const x = isInitialBurst 
            ? window.innerWidth / 2 + (Math.random() - 0.5) * 200
            : Math.random() * window.innerWidth;
        const y = isInitialBurst 
            ? window.innerHeight / 2
            : -size - Math.random() * 500;
        
        const angle = isInitialBurst ? Math.random() * Math.PI * 2 : 0;
        const speed = isInitialBurst ? (10 + Math.random() * 15) * intensity : 0;
        
        return {
            img,
            x,
            y,
            vx: isInitialBurst ? Math.cos(angle) * speed : (Math.random() - 0.5) * 2,
            vy: isInitialBurst ? Math.sin(angle) * speed - 5 : 2 + Math.random() * 3,
            size,
            rotation: Math.random() * 360,
            rotationSpeed: (Math.random() - 0.5) * 15 * intensity,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.02 + Math.random() * 0.03,
            wobbleAmp: (30 + Math.random() * 50) * intensity,
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
        
        const intensity = getIntensityMultiplier(usdValue);
        console.log('🎉 TRIGGERING EPIC CONFETTI!', { imageCount: loadedImages.length, usdValue, intensity });
        
        // Screen flash
        setScreenFlash(true);
        setTimeout(() => setScreenFlash(false), 150);
        
        // Show USD splash if value is over $0.01
        if (usdValue >= 0.01) {
            setDisplayedUsdValue(usdValue);
            setTimeout(() => {
                setShowUsdSplash(true);
            }, 400); // Delay slightly after screen flash
        }
        
        // Scale particle counts by intensity
        const scaledBurstCount = Math.floor(40 * intensity);
        const scaledRainCount = Math.floor(particleCount * intensity);
        const scaledSparkleCount = Math.floor(150 * intensity);
        
        // Initial burst of confetti from center
        const burstConfetti = [];
        for (let i = 0; i < scaledBurstCount; i++) {
            burstConfetti.push(createConfetti(loadedImages, true, intensity));
        }
        
        // Rain confetti
        const rainConfetti = [];
        for (let i = 0; i < scaledRainCount; i++) {
            const p = createConfetti(loadedImages, false, intensity);
            p.delay = Math.random() * 3000; // Stagger the rain
            rainConfetti.push(p);
        }
        
        particlesRef.current = [...burstConfetti, ...rainConfetti];
        
        // Initial sparkle explosion
        const initialSparkles = [];
        for (let i = 0; i < scaledSparkleCount; i++) {
            initialSparkles.push(createSparkle(
                window.innerWidth / 2 + (Math.random() - 0.5) * 100,
                window.innerHeight / 2 + (Math.random() - 0.5) * 100,
                true,
                intensity
            ));
        }
        sparklesRef.current = initialSparkles;
        
        // Schedule firework bursts - more fireworks for higher values
        fireworksRef.current = [];
        const baseFireworkTimes = [500, 1200, 2000, 2800, 3500, 4500];
        const fireworkCount = Math.ceil(baseFireworkTimes.length * intensity);
        const fireworkTimes = baseFireworkTimes.slice(0, fireworkCount);
        
        fireworkTimes.forEach(time => {
            setTimeout(() => {
                if (animationRef.current) {
                    const x = 100 + Math.random() * (window.innerWidth - 200);
                    const y = 100 + Math.random() * (window.innerHeight / 2);
                    fireworksRef.current.push(...createFireworkBurst(x, y, intensity));
                }
            }, time);
        });
        
        setIsActive(true);
        startTimeRef.current = performance.now();
        
    }, [trigger, loadedImages, particleCount, usdValue, createConfetti, createSparkle, createFireworkBurst, getIntensityMultiplier]);
    
    // Main animation loop
    useEffect(() => {
        if (!isActive) return;
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        const intensity = getIntensityMultiplier(usdValue);
        
        const animate = (currentTime) => {
            const elapsed = currentTime - startTimeRef.current;
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Add ambient sparkles throughout
            if (Math.random() < 0.3 * intensity && elapsed < duration - 1000) {
                sparklesRef.current.push(createSparkle(
                    Math.random() * window.innerWidth,
                    Math.random() * window.innerHeight * 0.7,
                    false,
                    intensity
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
                setShowUsdSplash(false);
            }
        };
        
        animationRef.current = requestAnimationFrame(animate);
        
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [isActive, duration, usdValue, createSparkle, getIntensityMultiplier]);
    
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
    
    // Format USD value for display
    const formatUsdDisplay = (value) => {
        if (value >= 1000) {
            return `$${(value / 1000).toFixed(1)}K`;
        } else if (value >= 1) {
            return `$${value.toFixed(2)}`;
        } else {
            return `$${value.toFixed(2)}`;
        }
    };
    
    if (!isActive && !screenFlash && !showUsdSplash) return null;
    
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
            
            {/* USD Value Splash */}
            {showUsdSplash && displayedUsdValue >= 0.01 && (
                <div
                    style={{
                        position: 'fixed',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10002,
                        pointerEvents: 'none',
                        animation: 'usdSplashIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                    }}
                >
                    {/* Outer glow ring */}
                    <div
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '300px',
                            height: '300px',
                            borderRadius: '50%',
                            background: 'radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%)',
                            animation: 'usdGlowPulse 1.5s ease-in-out infinite'
                        }}
                    />
                    
                    {/* Main value display */}
                    <div
                        style={{
                            position: 'relative',
                            textAlign: 'center',
                            animation: 'usdTextGlow 1s ease-in-out infinite alternate'
                        }}
                    >
                        {/* "You received" text */}
                        <div
                            style={{
                                fontSize: '1.5rem',
                                fontWeight: '600',
                                color: '#FFFFFF',
                                textShadow: '0 0 20px rgba(255,215,0,0.8), 0 0 40px rgba(255,215,0,0.4)',
                                marginBottom: '0.5rem',
                                opacity: 0,
                                animation: 'usdLabelFadeIn 0.5s 0.3s forwards'
                            }}
                        >
                            You received
                        </div>
                        
                        {/* USD Amount */}
                        <div
                            style={{
                                fontSize: displayedUsdValue >= 100 ? '5rem' : displayedUsdValue >= 10 ? '6rem' : '7rem',
                                fontWeight: '900',
                                background: 'linear-gradient(180deg, #FFD700 0%, #FFA500 50%, #FF8C00 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                textShadow: 'none',
                                filter: 'drop-shadow(0 0 30px rgba(255,215,0,0.8)) drop-shadow(0 0 60px rgba(255,165,0,0.5))',
                                letterSpacing: '-0.05em',
                                lineHeight: 1
                            }}
                        >
                            {formatUsdDisplay(displayedUsdValue)}
                        </div>
                        
                        {/* "in tips!" text */}
                        <div
                            style={{
                                fontSize: '1.5rem',
                                fontWeight: '600',
                                color: '#FFFFFF',
                                textShadow: '0 0 20px rgba(255,215,0,0.8), 0 0 40px rgba(255,215,0,0.4)',
                                marginTop: '0.5rem',
                                opacity: 0,
                                animation: 'usdLabelFadeIn 0.5s 0.5s forwards'
                            }}
                        >
                            in tips!
                        </div>
                    </div>
                    
                    {/* Sparkle decorations around the text */}
                    {[...Array(8)].map((_, i) => (
                        <div
                            key={i}
                            style={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                width: '20px',
                                height: '20px',
                                transform: `translate(-50%, -50%) rotate(${i * 45}deg) translateY(-120px)`,
                                animation: `sparkleOrbit 3s linear infinite`,
                                animationDelay: `${i * 0.2}s`
                            }}
                        >
                            <div
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    background: '#FFD700',
                                    clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
                                    animation: 'sparkleTwinkle 0.5s ease-in-out infinite alternate',
                                    animationDelay: `${i * 0.1}s`
                                }}
                            />
                        </div>
                    ))}
                </div>
            )}
            
            {/* CSS for animations */}
            <style>{`
                @keyframes flashPulse {
                    0% { opacity: 0; transform: scale(0.8); }
                    50% { opacity: 1; transform: scale(1.1); }
                    100% { opacity: 0; transform: scale(1.2); }
                }
                
                @keyframes usdSplashIn {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.3) rotate(-10deg);
                    }
                    60% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1.1) rotate(2deg);
                    }
                    80% {
                        transform: translate(-50%, -50%) scale(0.95) rotate(-1deg);
                    }
                    100% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1) rotate(0deg);
                    }
                }
                
                @keyframes usdGlowPulse {
                    0%, 100% {
                        opacity: 0.5;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    50% {
                        opacity: 0.8;
                        transform: translate(-50%, -50%) scale(1.2);
                    }
                }
                
                @keyframes usdTextGlow {
                    0% {
                        filter: drop-shadow(0 0 30px rgba(255,215,0,0.8)) drop-shadow(0 0 60px rgba(255,165,0,0.5));
                    }
                    100% {
                        filter: drop-shadow(0 0 50px rgba(255,215,0,1)) drop-shadow(0 0 80px rgba(255,165,0,0.7));
                    }
                }
                
                @keyframes usdLabelFadeIn {
                    0% {
                        opacity: 0;
                        transform: translateY(10px);
                    }
                    100% {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                @keyframes sparkleOrbit {
                    0% {
                        transform: translate(-50%, -50%) rotate(0deg) translateY(-120px) rotate(0deg);
                    }
                    100% {
                        transform: translate(-50%, -50%) rotate(360deg) translateY(-120px) rotate(-360deg);
                    }
                }
                
                @keyframes sparkleTwinkle {
                    0% {
                        opacity: 0.4;
                        transform: scale(0.8);
                    }
                    100% {
                        opacity: 1;
                        transform: scale(1.2);
                    }
                }
            `}</style>
        </>,
        document.body
    );
};

export default TokenConfetti;
