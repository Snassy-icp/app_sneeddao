import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * TokenConfetti - A confetti rain effect using circular token logos
 * 
 * Props:
 * - tokenLogos: Array of logo URLs to use as confetti particles
 * - trigger: Boolean to trigger the confetti (or increment to retrigger)
 * - duration: How long the confetti runs (default 5000ms)
 * - particleCount: Number of particles (default 50)
 */
const TokenConfetti = ({ 
    tokenLogos = [], 
    trigger = false, 
    duration = 6000, 
    particleCount = 60 
}) => {
    const [particles, setParticles] = useState([]);
    const [isActive, setIsActive] = useState(false);
    const [loadedImages, setLoadedImages] = useState(new Map());
    const animationRef = useRef(null);
    const startTimeRef = useRef(null);
    const particlesRef = useRef([]);
    
    // Preload all images
    useEffect(() => {
        if (tokenLogos.length === 0) return;
        
        const loadImage = (url) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ url, img, loaded: true });
                img.onerror = () => resolve({ url, img: null, loaded: false });
                img.src = url;
            });
        };
        
        Promise.all(tokenLogos.map(loadImage)).then(results => {
            const loaded = new Map();
            results.forEach(result => {
                if (result.loaded) {
                    loaded.set(result.url, result.img);
                }
            });
            setLoadedImages(loaded);
        });
    }, [tokenLogos]);
    
    // Create a single particle with random properties
    const createParticle = useCallback((id, logos) => {
        const logoUrl = logos[Math.floor(Math.random() * logos.length)];
        const size = 24 + Math.random() * 36; // 24-60px
        const startX = Math.random() * window.innerWidth;
        const startY = -size - Math.random() * 300; // Start above viewport, staggered
        
        // Determine spin direction (clockwise or counter-clockwise)
        const spinDirection = Math.random() > 0.5 ? 1 : -1;
        // Varying spin speeds - some fast, some slow
        const spinSpeed = (2 + Math.random() * 10) * spinDirection; // 2-12 degrees/frame
        
        return {
            id,
            logoUrl,
            size,
            x: startX,
            y: startY,
            baseX: startX, // Store initial X for wobble calculation
            // Horizontal drift (slight wind effect)
            vx: (Math.random() - 0.3) * 1.5, // Slight bias to the right like wind
            // Vertical speed (falling) - larger particles fall faster
            vy: 1.5 + (size / 60) * 2 + Math.random() * 2,
            // Rotation
            rotation: Math.random() * 360,
            rotationSpeed: spinSpeed,
            // Wobble (sinusoidal horizontal motion like a falling leaf)
            wobbleOffset: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.015 + Math.random() * 0.025,
            wobbleAmplitude: 30 + Math.random() * 60,
            // Opacity - larger particles slightly more opaque
            opacity: 0.75 + (size / 60) * 0.25,
            // Delay before appearing - creates a rain effect
            delay: Math.random() * 2000,
            // Track when this particle started
            startTime: null,
            // Slight acceleration (gravity feel)
            gravity: 0.02 + Math.random() * 0.03
        };
    }, []);
    
    // Initialize particles when triggered
    useEffect(() => {
        if (!trigger || loadedImages.size === 0) return;
        
        const logos = Array.from(loadedImages.keys());
        const newParticles = [];
        
        for (let i = 0; i < particleCount; i++) {
            newParticles.push(createParticle(i, logos));
        }
        
        particlesRef.current = newParticles;
        setParticles(newParticles);
        setIsActive(true);
        startTimeRef.current = performance.now();
        
    }, [trigger, loadedImages, particleCount, createParticle]);
    
    // Animation loop
    useEffect(() => {
        if (!isActive || particles.length === 0) return;
        
        const animate = (currentTime) => {
            const elapsed = currentTime - startTimeRef.current;
            
            // Update each particle
            const updatedParticles = particlesRef.current.map(particle => {
                // Check if this particle should start yet
                if (elapsed < particle.delay) {
                    return particle;
                }
                
                // Track when this particle actually started
                if (!particle.startTime) {
                    particle.startTime = currentTime;
                }
                
                const particleTime = currentTime - particle.startTime;
                
                // Calculate wobble (leaf-like motion)
                const wobble = Math.sin(particleTime * particle.wobbleSpeed + particle.wobbleOffset) * particle.wobbleAmplitude;
                
                // Apply slight gravity acceleration
                const newVy = particle.vy + particle.gravity;
                
                // Calculate new position
                const newX = particle.baseX + wobble + (particle.vx * particleTime * 0.01);
                const newY = particle.y + newVy;
                
                // Calculate opacity with smooth fade at end
                let newOpacity = particle.opacity;
                if (elapsed > duration - 1500) {
                    newOpacity = particle.opacity * Math.max(0, (duration - elapsed) / 1500);
                }
                // Also fade as particle goes below screen
                if (newY > window.innerHeight * 0.8) {
                    const fadeProgress = (newY - window.innerHeight * 0.8) / (window.innerHeight * 0.3);
                    newOpacity = newOpacity * Math.max(0, 1 - fadeProgress);
                }
                
                return {
                    ...particle,
                    x: newX,
                    y: newY,
                    vy: Math.min(newVy, 8), // Cap max fall speed
                    rotation: particle.rotation + particle.rotationSpeed,
                    opacity: newOpacity
                };
            });
            
            particlesRef.current = updatedParticles;
            setParticles([...updatedParticles]);
            
            // Stop animation after duration
            if (elapsed < duration) {
                animationRef.current = requestAnimationFrame(animate);
            } else {
                setIsActive(false);
                setParticles([]);
            }
        };
        
        animationRef.current = requestAnimationFrame(animate);
        
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [isActive, duration]);
    
    if (!isActive || particles.length === 0) return null;
    
    return createPortal(
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                pointerEvents: 'none',
                zIndex: 10000,
                overflow: 'hidden'
            }}
        >
            {particles.map(particle => {
                // Don't render if still in delay period
                const elapsed = performance.now() - startTimeRef.current;
                if (elapsed < particle.delay) return null;
                
                // Don't render if off screen
                if (particle.y > window.innerHeight + particle.size) return null;
                
                    return (
                        <div
                            key={particle.id}
                            style={{
                                position: 'absolute',
                                left: particle.x,
                                top: particle.y,
                                width: particle.size,
                                height: particle.size,
                                transform: `rotate(${particle.rotation}deg) scale(${0.9 + particle.opacity * 0.1})`,
                                opacity: particle.opacity,
                                willChange: 'transform, left, top, opacity',
                                transition: 'none',
                                filter: `drop-shadow(0 0 ${particle.size * 0.15}px rgba(255,215,0,0.6))`
                            }}
                        >
                            <img
                                src={particle.logoUrl}
                                alt=""
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                    boxShadow: `
                                        0 2px 8px rgba(0,0,0,0.4),
                                        0 0 ${particle.size * 0.4}px rgba(255,215,0,0.4),
                                        inset 0 0 ${particle.size * 0.2}px rgba(255,255,255,0.1)
                                    `,
                                    border: '2px solid rgba(255,215,0,0.6)'
                                }}
                            />
                        </div>
                    );
            })}
        </div>,
        document.body
    );
};

export default TokenConfetti;
