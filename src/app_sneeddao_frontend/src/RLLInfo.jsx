import React, { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import PrincipalBox from './PrincipalBox';
import { headerStyles } from './styles/HeaderStyles';
import ReactFlow, { 
    Background, 
    Controls,
    MiniMap,
    MarkerType,
    Position,
    useNodes,
    useEdges,
    useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import './RLLInfo.css';
import { Principal } from '@dfinity/principal';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { Actor, HttpAgent } from '@dfinity/agent';
import { createActor as createNnsGovActor } from 'external/nns_gov';
import { createActor as createVectorActor } from 'external/icrc55_vector';
import { createActor as createExVectorActor } from 'external/icrc55_exvector';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import priceService from './services/PriceService';
import Header from './components/Header';
import { useTheme } from './contexts/ThemeContext';
import { FaCoins, FaChartLine, FaWallet, FaCubes, FaDollarSign, FaLayerGroup, FaLeaf, FaExternalLinkAlt } from 'react-icons/fa';
import { useDenomination } from './contexts/DenominationContext';


// Page accent colors - gold/amber theme for tokenomics
const rllPrimary = '#f59e0b';

// Styles for the expandable sections
const getStyles = (theme) => ({
    section: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.25rem',
        marginTop: '16px',
        color: theme.colors.primaryText,
        boxShadow: theme.colors.cardShadow
    },
    expandableHeader: {
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        padding: '12px 16px',
        marginBottom: '8px',
        borderRadius: '10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        transition: 'all 0.3s ease'
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center'
    },
    headerRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    },
    content: {
        padding: '10px'
    },
    item: {
        background: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px',
        padding: '12px 14px',
        marginBottom: '8px'
    },
    itemHeader: {
        cursor: 'pointer',
        fontWeight: 'bold',
        marginBottom: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    itemContent: {
        marginLeft: '4px',
        fontSize: '0.92rem',
        lineHeight: 1.5
    },
    list: {
        listStyle: 'none',
        padding: 0,
        margin: '10px 0'
    },
    flowContainer: {
        position: 'relative',
        width: '100%',
        height: '600px',
        background: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        boxShadow: theme.colors.cardShadow
    },
    link: {
        color: rllPrimary,
        textDecoration: 'none',
        fontWeight: '500',
        '&:hover': {
            textDecoration: 'underline'
        }
    },
    detailsSection: {
        marginTop: '10px',
        padding: '10px',
        background: `${rllPrimary}05`,
        border: `1px solid ${rllPrimary}15`,
        borderRadius: '10px'
    },
    canisterId: {
        fontFamily: 'monospace',
        background: `${rllPrimary}10`,
        color: theme.colors.primaryText,
        padding: '6px 10px',
        borderRadius: '8px',
        fontSize: '0.85em',
        border: `1px solid ${rllPrimary}20`
    },
    spinner: {
        border: `3px solid ${theme.colors.border}`,
        borderTop: `3px solid ${rllPrimary}`,
        borderRadius: '50%',
        width: '20px',
        height: '20px',
        animation: 'spin 1s linear infinite'
    },
    statusItem: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
        marginBottom: '5px'
    },
    infoIcon: {
        color: rllPrimary,
        cursor: 'help',
        fontSize: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        border: `1px solid ${rllPrimary}`,
        marginLeft: '6px',
        fontWeight: '600'
    },
    heading: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px'
    },
    sectionHeader: {
        background: 'transparent',
        border: 'none',
        padding: '0 0 12px',
        borderBottom: `1px solid ${theme.colors.border}`,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
    },
    sectionIcon: {
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        background: `${rllPrimary}18`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: '12px',
        flexShrink: 0
    },
    expandButton: {
        background: 'transparent',
        border: 'none',
        color: rllPrimary,
        fontSize: '1.2em',
        cursor: 'pointer',
        padding: '0 5px',
        lineHeight: 1
    },
    headingLeft: {
        display: 'flex',
        alignItems: 'center'
    },
    headingRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    },
    globeIcon: {
        color: rllPrimary,
        cursor: 'pointer',
        fontSize: '16px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        marginRight: '8px'
    },
    priceCard: {
        background: `${rllPrimary}08`,
        border: `1px solid ${rllPrimary}20`,
        borderRadius: '14px',
        padding: '1rem',
        textAlign: 'center',
        boxShadow: theme.colors.cardShadow
    },
});

// Node styles
const getNodeStyles = (theme) => ({
    infrastructure: { background: theme.colors.primaryBg, color: theme.colors.primaryText, border: `1.5px solid ${theme.colors.accent}`, width: 180 },
    tokenManagement: { background: theme.colors.primaryBg, color: theme.colors.primaryText, border: `1.5px solid ${theme.colors.success}`, width: 180 },
    revenue: { background: theme.colors.primaryBg, color: theme.colors.primaryText, border: `1.5px solid ${rllPrimary}`, width: 180 }
});

// Edge styles
const getEdgeStyles = (theme) => ({
    icp: {
        stroke: theme.colors.accent,
        strokeWidth: 2,
        animated: true,
    },
    sneed: {
        stroke: theme.colors.success,
        strokeWidth: 2,
        animated: true,
    },
    various: {
        stroke: theme.colors.warning,
        strokeWidth: 2,
        animated: true,
    },
});

// Default styles for global usage (will be overridden in component)
const edgeStyles = {
    icp: { stroke: '#0984e3', strokeWidth: 2, animated: true },
    sneed: { stroke: '#00b894', strokeWidth: 2, animated: true },
    various: { stroke: '#fdcb6e', strokeWidth: 2, animated: true }
};

const nodeStyles = {
    infrastructure: { background: 'rgba(45, 52, 54, 0.8)', color: '#fff', border: '1px solid #0984e3', borderRadius: '8px', padding: '10px', width: 180 },
    tokenManagement: { background: 'rgba(45, 52, 54, 0.8)', color: '#fff', border: '1px solid #00b894', borderRadius: '8px', padding: '10px', width: 180 },
    revenue: { background: 'rgba(45, 52, 54, 0.8)', color: '#fff', border: '1px solid #fdcb6e', borderRadius: '8px', padding: '10px', width: 180 }
};

// Custom animated token component
const AnimatedToken = ({ type, x, y, scale = 1 }) => {
    const size = 24 * scale;
    const reactFlowInstance = useReactFlow();
    const viewport = reactFlowInstance.getViewport();
    
    // Transform the coordinates based on viewport zoom and pan
    const transformedX = x * viewport.zoom + viewport.x;
    const transformedY = y * viewport.zoom + viewport.y;

    return (
        <div
            style={{
                position: 'absolute',
                left: transformedX,
                top: transformedY,
                width: size,
                height: size,
                borderRadius: '50%',
                background: `url(${type === 'icp' ? 'icp_symbol.svg' : 'sneed_logo.png'})`,
                backgroundSize: 'cover',
                animation: 'pop-in 0.3s ease-out',
                zIndex: 1000,
                transform: `translate(-50%, -50%) scale(${viewport.zoom})`, // Scale with zoom to maintain relative size
                pointerEvents: 'none'
            }}
        />
    );
};

// Custom burn effect component
const BurnEffect = ({ x, y, scale = 1 }) => {
    const reactFlowInstance = useReactFlow();
    const viewport = reactFlowInstance.getViewport();
    const size = 32 * scale; // Slightly larger than tokens
    
    // Transform the coordinates based on viewport zoom and pan
    const transformedX = x * viewport.zoom + viewport.x;
    const transformedY = y * viewport.zoom + viewport.y;

    return (
        <div
            style={{
                position: 'absolute',
                left: transformedX,
                top: transformedY,
                width: size,
                height: size,
                background: 'radial-gradient(circle, rgba(255,165,0,0.8) 0%, rgba(255,69,0,0.6) 50%, rgba(255,0,0,0) 100%)',
                animation: 'burn-effect 0.5s ease-out forwards',
                zIndex: 999,
                transform: `translate(-50%, -50%) scale(${viewport.zoom})`,
                pointerEvents: 'none'
            }}
        />
    );
};

// Custom distribution effect component
const DistributionEffect = ({ x, y, type, scale = 1 }) => {
    const reactFlowInstance = useReactFlow();
    const viewport = reactFlowInstance.getViewport();
    const size = 16 * scale; // Smaller than regular tokens
    
    // Create 8 mini tokens for the distribution effect
    const tokens = Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI * 2) / 8; // Evenly space around circle
        
        // Transform coordinates based on viewport
        const transformedX = x * viewport.zoom + viewport.x;
        const transformedY = y * viewport.zoom + viewport.y;

        // Create unique animation name for this token
        const animationName = `distribute-token-${i}`;

        return (
            <div
                key={i}
                style={{
                    position: 'absolute',
                    left: `${transformedX}px`,
                    top: `${transformedY}px`,
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    background: `url(${type === 'icp' ? 'icp_symbol.svg' : 'sneed_logo.png'})`,
                    backgroundSize: 'cover',
                    animation: `${animationName} 2s cubic-bezier(0.4, 0, 0.2, 1) forwards`,
                    zIndex: 999,
                    transform: `translate(-50%, -50%) scale(${viewport.zoom})`,
                    pointerEvents: 'none'
                }}
            >
                <style>
                    {`
                        @keyframes ${animationName} {
                            0% {
                                transform: translate(-50%, -50%) scale(${viewport.zoom});
                                opacity: 1;
                            }
                            100% {
                                transform: translate(
                                    calc(-50% + ${Math.cos(angle) * (100 / viewport.zoom)}px),
                                    calc(-50% + ${Math.sin(angle) * (100 / viewport.zoom)}px)
                                ) scale(${viewport.zoom * 0.3});
                                opacity: 0;
                            }
                        }
                    `}
                </style>
            </div>
        );
    });

    return <>{tokens}</>;
};

// Token animation manager component
const TokenAnimationManager = ({ edges, nodes }) => {
    const [tokens, setTokens] = useState([]);
    const [burnEffects, setBurnEffects] = useState([]);
    const [distributionEffects, setDistributionEffects] = useState([]);
    const reactFlowInstance = useReactFlow();

    const isSourceNode = useCallback((nodeId) => {
        return ['1', '11', '13', '14'].includes(nodeId); // 2y neuron, LP Rewards, SneedLock, Swaprunner
    }, []);

    const createToken = useCallback((edge, percentage = 1, tokenType = null) => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        
        if (!sourceNode || !targetNode) return null;

        // Determine token type
        let type;
        if (tokenType) {
            type = tokenType;
        } else if (edge.style === edgeStyles.icp) {
            type = 'icp';
        } else if (edge.style === edgeStyles.sneed) {
            type = 'sneed';
        } else if (['11', '13', '14'].includes(sourceNode.id)) {
            // For revenue sources that can generate both types, randomly choose
            type = Math.random() < 0.5 ? 'icp' : 'sneed';
        } else if (sourceNode.id === '1') {
            // 2y neuron always generates ICP
            type = 'icp';
        } else {
            type = 'sneed'; // default fallback
        }

        const scale = percentage;

        // Check destinations
        const isBurnDestination = targetNode.id === '8'; // SNEED Burn Address
        const isDistributionDestination = targetNode.id === '9'; // RLL Distribution

        return {
            id: `token-${edge.id}-${Date.now()}`,
            type,
            edge: edge.id,
            scale,
            progress: 0,
            sourceX: sourceNode.position.x + (sourceNode.width || 180) / 2,
            sourceY: sourceNode.position.y + (sourceNode.height || 40) / 2,
            targetX: targetNode.position.x + (targetNode.width || 180) / 2,
            targetY: targetNode.position.y + (targetNode.height || 40) / 2,
            isBurnDestination,
            isDistributionDestination,
            previousNode: sourceNode.id // Track the source node
        };
    }, [nodes]);

    const animateTokens = useCallback(() => {
        setTokens(prevTokens => {
            let updatedTokens = [];
            
            // First, process existing tokens
            prevTokens.forEach(token => {
                const newProgress = token.progress + 0.01;
                
                if (newProgress < 1) {
                    // Keep moving tokens that haven't reached their destination
                    updatedTokens.push({
                        ...token,
                        progress: newProgress
                    });
                } else {
                    // Handle tokens that have reached their destination
                    const edge = edges.find(e => e.id === token.edge);
                    if (!edge) return;

                    if (token.isBurnDestination) {
                        setBurnEffects(prev => [...prev, {
                            id: `burn-${Date.now()}`,
                            x: token.targetX,
                            y: token.targetY,
                            scale: token.scale,
                            createdAt: Date.now()
                        }]);
                    } else if (token.isDistributionDestination) {
                        setDistributionEffects(prev => [...prev, {
                            id: `distribute-${Date.now()}`,
                            x: token.targetX,
                            y: token.targetY,
                            type: token.type,
                            scale: token.scale,
                            createdAt: Date.now()
                        }]);
                    } else if (edge.target === '2') {
                        // When tokens reach ICP Neuron Vector (node 2)
                        // Check where the token came from to determine where it should go
                        const nextEdge = edge.source === '1' ?
                            // If from 2y neuron (maturity), send to ICP Splitter
                            edges.find(e => e.id === 'e2') :
                            // If from ICP Splitter (compounding), send to 2y neuron
                            edges.find(e => e.id === 'e1b');
                        
                        if (nextEdge) {
                            const newToken = createToken(nextEdge, token.scale, token.type);
                            if (newToken) updatedTokens.push(newToken);
                        }
                    } else if (edge.target === '3') {
                        // Handle ICP Splitter node
                        const outgoingEdges = edges.filter(e => e.source === '3');
                        outgoingEdges.forEach(outEdge => {
                            const percentage = parseFloat(outEdge.label) / 100 || 1;
                            // Double the scale after splitting
                            const newToken = createToken(outEdge, token.scale * percentage * 1.75, token.type);
                            if (newToken) updatedTokens.push(newToken);
                        });
                    } else if (edge.target === '4') {
                        // When ICP reaches Buyback Vector, convert to SNEED and send to SNEED Splitter
                        const nextEdge = edges.find(e => e.source === '4' && e.target === '5');
                        if (nextEdge) {
                            const newToken = createToken(nextEdge, token.scale, 'sneed'); // Force token type to SNEED
                            if (newToken) updatedTokens.push(newToken);
                        }
                    } else if (edge.target === '12') {
                        // When reaching Products, forward to Revenue Collector
                        const nextEdge = edges.find(e => e.source === '12' && e.target === '10');
                        if (nextEdge) {
                            const newToken = createToken(nextEdge, token.scale, token.type);
                            if (newToken) updatedTokens.push(newToken);
                        }
                    } else if (edge.target === '10') {
                        // When reaching the Revenue Collector, route to appropriate splitter based on token type
                        const nextEdge = token.type === 'icp' ? 
                            edges.find(e => e.id === 'e12') :  // To ICP Splitter
                            edges.find(e => e.id === 'e12b');  // To SNEED Splitter
                        if (nextEdge) {
                            const newToken = createToken(nextEdge, token.scale, token.type);
                            if (newToken) updatedTokens.push(newToken);
                        }
                    } else if (edge.target === '7') {
                        // When tokens reach DeFi Canister, forward to RLL Distribution
                        const nextEdge = edges.find(e => e.source === '7' && e.target === '9');
                        if (nextEdge) {
                            const newToken = createToken(nextEdge, token.scale, token.type);
                            if (newToken) updatedTokens.push(newToken);
                        }
                    } else if (edge.target === '5') {
                        // Handle SNEED splitter nodes
                        const outgoingEdges = edges.filter(e => e.source === edge.target);
                        outgoingEdges.forEach(outEdge => {
                            const percentage = parseFloat(outEdge.label) / 100 || 1;
                            // Double the scale after splitting
                            const newToken = createToken(outEdge, token.scale * percentage * 1.75, token.type);
                            if (newToken) updatedTokens.push(newToken);
                        });
                    }
                }
            });

            // Then spawn new tokens at source nodes (keeping original size)
            edges.forEach(edge => {
                // For 2y neuron, spawn tokens to ICP Neuron Vector
                if (edge.source === '1' && edge.target === '2') {
                    if (Math.random() < 0.005) {
                        const newToken = createToken(edge, 1, 'icp');
                        if (newToken) updatedTokens.push(newToken);
                    }
                }
                // For other source nodes
                else if (isSourceNode(edge.source) && edge.source !== '1') {
                    if (Math.random() < 0.005 && !updatedTokens.some(t => t.edge === edge.id)) {
                        const newToken = createToken(edge);
                        if (newToken) updatedTokens.push(newToken);
                    }
                }
            });

            return updatedTokens;
        });

        setBurnEffects(prev => prev.filter(effect => Date.now() - effect.createdAt < 500));
        setDistributionEffects(prev => prev.filter(effect => Date.now() - effect.createdAt < 800));
    }, [edges, createToken, isSourceNode]);

    useEffect(() => {
        const interval = setInterval(animateTokens, 50);
        return () => clearInterval(interval);
    }, [animateTokens]);

    return (
        <>
            {tokens.map(token => (
                <AnimatedToken
                    key={token.id}
                    type={token.type}
                    x={token.sourceX + (token.targetX - token.sourceX) * token.progress}
                    y={token.sourceY + (token.targetY - token.sourceY) * token.progress}
                    scale={token.scale}
                />
            ))}
            {burnEffects.map(effect => (
                <BurnEffect
                    key={effect.id}
                    x={effect.x}
                    y={effect.y}
                    scale={effect.scale}
                />
            ))}
            {distributionEffects.map(effect => (
                <DistributionEffect
                    key={effect.id}
                    x={effect.x}
                    y={effect.y}
                    type={effect.type}
                    scale={effect.scale}
                />
            ))}
        </>
    );
};

// A small floating card. Hover cards follow the pointer and take no clicks; pinned
// cards (opened by a tap or a click) stay until closed, and can carry a link.
const Popover = ({ x, y, hover, onClose, link, ignoreRef, children }) => {
    const ref = useRef(null);
    const [pos, setPos] = useState({ left: -9999, top: -9999 });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const w = el.offsetWidth, h = el.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        let left, top;
        if (x == null) {
            left = Math.max(12, (vw - w) / 2);
            top = Math.max(12, (vh - h) / 2);
        } else {
            left = Math.min(Math.max(12, x + 12), Math.max(12, vw - w - 12));
            top = y + 12 + h > vh - 12 ? Math.max(12, y - h - 12) : y + 12;
        }
        setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
    });
    useEffect(() => {
        if (hover) return;
        const down = (e) => {
            if (ref.current?.contains(e.target)) return;
            if (ignoreRef?.current?.contains(e.target)) return;
            onClose?.();
        };
        const key = (e) => { if (e.key === 'Escape') onClose?.(); };
        document.addEventListener('pointerdown', down, true);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); };
    }, [hover, onClose, ignoreRef]);
    return (
        <div ref={ref} className={`rll-popover${hover ? ' rll-popover-hover' : ''}`} style={pos} role={hover ? 'tooltip' : 'dialog'}>
            {!hover && <button type="button" className="rll-popover-close" aria-label="Close" onClick={onClose}>×</button>}
            <div style={{ paddingRight: hover ? 0 : 24 }}>{children}</div>
            {!hover && link && (
                <div className="rll-popover-actions">
                    <a href={link} target="_blank" rel="noopener noreferrer">Open <FaExternalLinkAlt size={10} /></a>
                </div>
            )}
        </div>
    );
};

// The "i" beside a heading: shows on hover with a mouse, toggles on a tap or a click.
const InfoTip = ({ text, label = 'What is this?' }) => {
    const [tip, setTip] = useState(null);
    const ref = useRef(null);
    const place = () => {
        const r = ref.current?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2 - 12, y: r.bottom - 4 } : { x: 0, y: 0 };
    };
    const close = useCallback(() => setTip(null), []);
    return (
        <>
            <button
                type="button"
                ref={ref}
                className="rll-infotip"
                aria-label={label}
                aria-expanded={!!tip}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setTip((t) => t || { ...place(), pinned: false }); }}
                onPointerLeave={() => setTip((t) => (t && !t.pinned ? null : t))}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setTip((t) => (t?.pinned ? null : { ...place(), pinned: true })); }}
            >i</button>
            {tip && <Popover x={tip.x} y={tip.y} hover={!tip.pinned} onClose={close} ignoreRef={ref}>{text}</Popover>}
        </>
    );
};

// Diagram card: hover follows the pointer; a tap or click pins it with a link.
const TooltipOverlay = ({ tooltip, onClose }) => {
    if (!tooltip || !tooltip.content) return null;
    return (
        <Popover x={tooltip.x} y={tooltip.y} hover={!tooltip.pinned} onClose={onClose} link={tooltip.link}>
            {tooltip.content}
        </Popover>
    );
};

// Duration text usable before the component's helpers are defined
const formatDurationStatic = (seconds) => {
    if (!seconds) return '0 seconds';
    const years = Math.floor(seconds / (365 * 24 * 60 * 60));
    const months = Math.floor((seconds % (365 * 24 * 60 * 60)) / (30 * 24 * 60 * 60));
    const days = Math.floor((seconds % (30 * 24 * 60 * 60)) / (24 * 60 * 60));
    const parts = [];
    if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    return parts.join(', ') || '< 1 day';
};

// Node definitions with their metadata (static text; the live vector data overrides splits and destinations)
const nodes = {
    infrastructure: {
        title: "Core Infrastructure",
        description: "The ICP side of the loop: the neuron that earns maturity, the vector that controls it, and the splitter that routes ICP",
        items: [
            {
                id: "1",
                title: "2-year ICP neuron",
                description: "Long-term ICP staking neuron (its current dissolve delay is shown below)",
                inputs: ["ICP from Neuron Vector"],
                outputs: ["Maturity to Neuron Vector"],
                details: "Controlled by ICP Neuron Vector for maturity collection and compounding",
                link: "https://dashboard.internetcomputer.org/neuron/4000934039483276792"
            },
            {
                id: "2",
                title: "ICP Neuron Vector",
                description: "Controls the NNS neuron: collects its maturity and compounds ICP back into it",
                inputs: ["ICP from Splitter (25%)", "Maturity from NNS Neuron"],
                outputs: ["ICP to NNS Neuron"],
                canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-wu6phoy.100000000010000000000000000000000000000000000000000000000000000",
                details: "Vector ID: 1 on Neuronpool",
                link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/1"
            },
            {
                id: "3",
                title: "ICP Splitter Vector",
                description: "Splits the ICP it receives between its destinations in the proportions set on the vector (read live below)",
                inputs: [
                    "ICP from Neuron Vector",
                    "ICP from Other Revenue Sources"
                ],
                outputs: [
                    "25% ICP to Treasury",
                    "25% ICP to Neuron Vector (for compounding)",
                    "50% ICP to Sneed Buyback Vector"
                ],
                canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-m7u3kpi.100000000060000000000000000000000000000000000000000000000000000",
                details: "Vector ID: 6 on Neuronpool",
                link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/6"
            }
        ]
    },
    tokenManagement: {
        title: "Token Management",
        description: "The SNEED side of the loop: buyback, the SNEED splitter, and where the SNEED ends up (burn, treasury, member rewards)",
        items: [
            {
                id: "4",
                title: "SNEED Buyback Vector",
                description: "Buys SNEED with ICP on the open market, in timed batches",
                inputs: ["ICP from Splitter (50%)"],
                outputs: ["100% SNEED to SNEED Splitter"],
                canisterId: "togwv-zqaaa-aaaal-qr7aa-cai",
                icrc1Account: "togwv-zqaaa-aaaal-qr7aa-cai-ihr3xbq.100000000120000000000000000000000000000000000000000000000000000",
                details: "Vector ID: 18 on ICPCoins",
                link: "https://beta.icpcoins.com/#/vector/modify/togwv-zqaaa-aaaal-qr7aa-cai/exchange/18"
            },
            {
                id: "5",
                title: "SNEED Splitter Vector",
                description: "Splits the SNEED it receives between burn, treasury and member rewards in the proportions set on the vector (read live below)",
                inputs: ["SNEED from Buyback"],
                outputs: [
                    "10% SNEED to Burn Address",
                    "10% SNEED to Treasury",
                    "80% SNEED to RLL Distribution"
                ],
                canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-vilbrxq.1000000002d0000000000000000000000000000000000000000000000000000",
                details: "Vector ID: 45 on Neuronpool",
                link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/45"
            },
            {
                id: "6",
                title: "Sneed DAO Treasury",
                description: "The SNS treasury: ICP and SNEED that only a DAO proposal can move",
                inputs: [
                    "ICP from Splitter (25%)", 
                    "SNEED from Splitter (10%)"
                ],
                outputs: ["Any via DAO proposal"],
                canisterId: "fi3zi-fyaaa-aaaaq-aachq-cai",
                details: "ICP Treasury: ICRC1 Account fi3zi-fyaaa-aaaaq-aachq-cai, ICP Account 580deb37eb3583e5854516481bd52c2618ca73ef6ee1c2df2b556bf85c0ce5a9\n\nSNEED Treasury: ICRC1 Account fi3zi-fyaaa-aaaaq-aachq-cai-laerbmy.8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de",
                link: "https://dashboard.internetcomputer.org/account/580deb37eb3583e5854516481bd52c2618ca73ef6ee1c2df2b556bf85c0ce5a9"
            },
            {
                id: "7",
                title: "Sneed DeFi Canister",
                description: "Treasury extension for ICRC1 tokens",
                inputs: [
                    "LP fees and other revenue (ICP, SNEED and other tokens)"
                ],
                outputs: [
                    "ICP to ICP Splitter Vector",
                    "Tokens to RLL Distribution"
                ],
                canisterId: "ok64y-uiaaa-aaaag-qdcbq-cai",
                link: "https://dashboard.internetcomputer.org/canister/ok64y-uiaaa-aaaag-qdcbq-cai"
            },
            {
                id: "8",
                title: "SNEED Burn Address",
                description: "SNEED sent here is burned: it leaves the supply for good",
                inputs: ["SNEED from Splitter (10%)"],
                outputs: [],
                canisterId: "fi3zi-fyaaa-aaaaq-aachq-cai"
            },
            {
                id: "9",
                title: "RLL Distribution Canister",
                description: "Holds rewards until SNEED voters claim them on the Rewards page",
                inputs: ["80% of bought SNEED from SNEED Splitter", "Tokens from DeFi Canister"],
                outputs: ["100% to Sneed Members (Rewards claimable on app.sneeddao.com)"],
                canisterId: "lvc4n-7aaaa-aaaam-adm6a-cai",
                link: "https://app.sneeddao.com/rll"
            }
        ]
    },
    revenue: {
        title: "Revenue Sources",
        description: "Where ICP and SNEED enter the loop besides neuron maturity: LP fees and product revenue",
        items: [
            {
                id: "11",
                title: "SNEED/ICP LP Rewards",
                description: "Liquidity provision rewards from ICPSwap",
                inputs: ["LP rewards"],
                outputs: ["ICP and SNEED rewards to Revenue Collector"],
                details: "Every SNEED/ICP position held by the Sneed DeFi canister",
                link: "https://app.icpswap.com/info-swap/pool/details/osyzs-xiaaa-aaaag-qc76q-cai"
            },
            {
                id: "13",
                title: "SneedLock",
                description: "Token and LP position locking product",
                inputs: ["User interactions"],
                outputs: ["ICP and SNEED revenue to Products"],
                link: "https://app.sneeddao.com/sneedlock"
            },
            {
                id: "14",
                title: "Swaprunner",
                description: "Automated trading product",
                inputs: ["User interactions"],
                outputs: ["ICP and SNEED revenue to Products"],
                link: "https://swaprunner.com"
            }
        ]
    }
};

// Edge definitions with percentages and additional details
const edges = {
    icpFlows: {
        title: "ICP Flows",
        items: [
            {
                id: "e1",
                source: "1",
                target: "2",
                description: "Maturity Collection",
                token: "ICP",
                percentage: "100%",
                type: "smoothstep",
                style: edgeStyles.icp,
                markerEnd: { type: MarkerType.ArrowClosed },
                data: {
                    description: "Maturity from the 2-year neuron to Neuron Vector",
                    token: "ICP",
                    percentage: "100%"
                }
            },
            {
                id: "e1b",
                source: "2",
                target: "1",
                description: "Neuron Compounding",
                token: "ICP",
                percentage: "100%",
                type: "smoothstep",
                style: edgeStyles.icp,
                markerEnd: { type: MarkerType.ArrowClosed },
                data: {
                    description: "ICP compounding back to the 2-year neuron",
                    token: "ICP",
                    percentage: "100%"
                }
            },
            {
                id: "e2",
                source: "2",
                target: "3",
                description: "Maturity Distribution",
                token: "ICP",
                percentage: "100%",
                type: "smoothstep",
                style: edgeStyles.icp,
                markerEnd: { type: MarkerType.ArrowClosed },
                data: {
                    description: "Maturity to ICP Splitter for distribution",
                    token: "ICP",
                    percentage: "100%"
                }
            },
            {
                id: "e2b",
                source: "3",
                target: "2",
                description: "Compounding Allocation",
                token: "ICP",
                percentage: "25%",
                type: "smoothstep",
                style: edgeStyles.icp,
                markerEnd: { type: MarkerType.ArrowClosed },
                data: {
                    description: "ICP allocated for neuron compounding",
                    token: "ICP",
                    percentage: "25%"
                }
            },
            {
                id: "e3",
                source: "3",
                target: "4",
                description: "ICP for SNEED buyback",
                token: "ICP",
                percentage: "50%"
            },
            {
                id: "e4",
                source: "3",
                target: "6",
                description: "ICP to Treasury reserves",
                token: "ICP",
                percentage: "25%"
            }
        ]
    },
    sneedFlows: {
        title: "SNEED Flows",
        items: [
            {
                id: "e5",
                source: "4",
                target: "5",
                description: "Bought SNEED to Splitter",
                token: "SNEED",
                percentage: "100%"
            },
            {
                id: "e6",
                source: "5",
                target: "6",
                description: "SNEED to Treasury",
                token: "SNEED",
                percentage: "10%"
            },
            {
                id: "e7",
                source: "5",
                target: "9",
                description: "SNEED to RLL Distribution",
                token: "SNEED",
                percentage: "80%"
            },
            {
                id: "e8",
                source: "5",
                target: "8",
                description: "SNEED to Burn Address",
                token: "SNEED",
                percentage: "10%"
            }
        ]
    },
    revenueFlows: {
        title: "Revenue Flows",
        items: [
            {
                id: "e10",
                source: "11",
                target: "10",
                description: "LP Rewards to Revenue Collector",
                token: "Various",
                percentage: "100%"
            },
            {
                id: "e11",
                source: "12",
                target: "10",
                description: "Product Revenue to Collector",
                token: "Various",
                percentage: "100%"
            },
            {
                id: "e12",
                source: "10",
                target: "3",
                description: "ICP Revenue to ICP Splitter",
                token: "ICP",
                percentage: "100%"
            },
            {
                id: "e12b",
                source: "10",
                target: "5",
                description: "SNEED Revenue to SNEED Splitter",
                token: "SNEED",
                percentage: "100%"
            },
            {
                id: "e13",
                source: "7",
                target: "9",
                description: "Tokens to RLL Distribution",
                token: "Various",
                percentage: "100%"
            },
            {
                id: "e14",
                source: "13",
                target: "12",
                description: "SneedLock Revenue",
                token: "Various",
                percentage: "100%"
            },
            {
                id: "e15",
                source: "14",
                target: "12",
                description: "Swaprunner Revenue",
                token: "Various",
                percentage: "100%"
            }
        ]
    }
};

// Define the initial nodes with positions
const initialNodes = [
    // Infrastructure nodes (top row)
    {
        id: '1',
        type: 'default',
        data: { 
            label: '2-year ICP neuron',
            description: "Long-term ICP staking neuron (its current dissolve delay is shown below)",
            inputs: ["ICP from Neuron Vector"],
            outputs: ["Maturity to Neuron Vector"],
            details: "Controlled by ICP Neuron Vector for maturity collection and compounding",
            link: "https://dashboard.internetcomputer.org/neuron/4000934039483276792"
        },
        position: { x: 300, y: 50 },
        style: nodeStyles.infrastructure,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '2',
        type: 'default',
        data: { 
            label: 'ICP Neuron Vector',
            description: "Controls the NNS neuron: collects its maturity and compounds ICP back into it",
            inputs: ["ICP from Splitter (25%)", "Maturity from NNS Neuron"],
            outputs: ["ICP to NNS Neuron"],
            canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-wu6phoy.100000000010000000000000000000000000000000000000000000000000000",
            details: "Vector ID: 1 on Neuronpool",
            link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/1"
        },
        position: { x: 300, y: 150 },
        style: nodeStyles.infrastructure,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '3',
        type: 'default',
        data: { 
            label: 'ICP Splitter Vector',
            description: "Splits the ICP it receives between its destinations in the proportions set on the vector (read live below)",
            inputs: [
                "ICP from Neuron Vector",
                "ICP from Other Revenue Sources"
            ],
            outputs: [
                "25% ICP to Treasury",
                "25% ICP to Neuron Vector (for compounding)",
                "50% ICP to Sneed Buyback Vector"
            ],
            canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-m7u3kpi.100000000060000000000000000000000000000000000000000000000000000",
            details: "Vector ID: 6 on Neuronpool",
            link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/6"
        },
        position: { x: 300, y: 250 },
        style: nodeStyles.infrastructure,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },

    // Token Management nodes (middle row)
    {
        id: '4',
        type: 'default',
        data: { 
            label: 'SNEED Buyback Vector',
            description: "Buys SNEED with ICP on the open market, in timed batches",
            inputs: ["ICP from Splitter (50%)"],
            outputs: ["100% SNEED to SNEED Splitter"],
            canisterId: "togwv-zqaaa-aaaal-qr7aa-cai",
            icrc1Account: "togwv-zqaaa-aaaal-qr7aa-cai-ihr3xbq.100000000120000000000000000000000000000000000000000000000000000",
            details: "Vector ID: 18 on ICPCoins",
            link: "https://beta.icpcoins.com/#/vector/modify/togwv-zqaaa-aaaal-qr7aa-cai/exchange/18"
        },
        position: { x: 100, y: 350 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '5',
        type: 'default',
        data: { 
            label: 'SNEED Splitter Vector',
            description: "Splits the SNEED it receives between burn, treasury and member rewards in the proportions set on the vector (read live below)",
            inputs: ["SNEED from Buyback"],
            outputs: [
                "10% SNEED to Burn Address",
                "10% SNEED to Treasury",
                "80% SNEED to RLL Distribution"
            ],
            canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-vilbrxq.1000000002d0000000000000000000000000000000000000000000000000000",
            details: "Vector ID: 45 on Neuronpool",
            link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/45"
        },
        position: { x: 300, y: 350 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '6',
        type: 'default',
        data: { 
            label: 'Sneed DAO Treasury',
            description: "The SNS treasury: ICP and SNEED that only a DAO proposal can move",
            inputs: [
                "ICP from Splitter (25%)", 
                "SNEED from Splitter (10%)"
            ],
            outputs: ["Any via DAO proposal"],
            canisterId: "fi3zi-fyaaa-aaaaq-aachq-cai",
            details: "ICP Treasury: ICRC1 Account fi3zi-fyaaa-aaaaq-aachq-cai, ICP Account 580deb37eb3583e5854516481bd52c2618ca73ef6ee1c2df2b556bf85c0ce5a9\n\nSNEED Treasury: ICRC1 Account fi3zi-fyaaa-aaaaq-aachq-cai-laerbmy.8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de",
            link: "https://dashboard.internetcomputer.org/account/580deb37eb3583e5854516481bd52c2618ca73ef6ee1c2df2b556bf85c0ce5a9"
        },
        position: { x: 500, y: 350 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '7',
        type: 'default',
        data: { 
            label: 'Sneed DeFi Canister',
            description: "Treasury extension for ICRC1 tokens",
            inputs: [
                "LP fees and other revenue (ICP, SNEED and other tokens)"
            ],
            outputs: [
                "ICP to ICP Splitter Vector",
                "Tokens to RLL Distribution"
            ],
            canisterId: "ok64y-uiaaa-aaaag-qdcbq-cai",
            link: "https://dashboard.internetcomputer.org/canister/ok64y-uiaaa-aaaag-qdcbq-cai"
        },
        position: { x: 300, y: 450 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '8',
        type: 'default',
        data: { 
            label: 'SNEED Burn Address',
            description: "SNEED sent here is burned: it leaves the supply for good",
            inputs: ["SNEED from Splitter (10%)"],
            outputs: [],
            canisterId: "fi3zi-fyaaa-aaaaq-aachq-cai"
        },
        position: { x: 500, y: 450 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '9',
        type: 'default',
        data: { 
            label: 'RLL Distribution',
            description: "Holds rewards until SNEED voters claim them on the Rewards page",
            inputs: ["80% of bought SNEED from SNEED Splitter", "Tokens from DeFi Canister"],
            outputs: ["100% to Sneed Members (Rewards claimable on app.sneeddao.com)"],
            canisterId: "lvc4n-7aaaa-aaaam-adm6a-cai",
            link: "https://app.sneeddao.com/rll"
        },
        position: { x: 300, y: 550 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },

    // Revenue nodes (bottom row)
    {
        id: '10',
        type: 'default',
        data: { 
            label: 'Other Revenue Sources',
            description: "Virtual collector for various revenue streams",
            inputs: ["Various token streams"],
            outputs: ["ICP to ICP Splitter Vector", "SNEED to SNEED Splitter Vector"]
        },
        position: { x: 100, y: 650 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '11',
        type: 'default',
        data: { 
            label: 'SNEED/ICP LP Rewards',
            description: "Liquidity provision rewards from ICPSwap",
            inputs: ["LP rewards"],
            outputs: ["ICP and SNEED rewards to Revenue Collector"],
            details: "Every SNEED/ICP position held by the Sneed DeFi canister",
            link: "https://app.icpswap.com/info-swap/pool/details/osyzs-xiaaa-aaaag-qc76q-cai"
        },
        position: { x: 300, y: 650 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '12',
        type: 'default',
        data: { 
            label: 'Products',
            description: "Virtual collector for product revenue",
            inputs: ["ICP and SNEED revenue from products"],
            outputs: ["ICP and SNEED to Revenue Collector"]
        },
        position: { x: 500, y: 650 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '13',
        type: 'default',
        data: { 
            label: 'SneedLock',
            description: "Token and LP position locking product",
            inputs: ["User interactions"],
            outputs: ["ICP and SNEED revenue to Products"],
            link: "https://app.sneeddao.com/sneedlock"
        },
        position: { x: 400, y: 750 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '14',
        type: 'default',
        data: { 
            label: 'Swaprunner',
            description: "Automated trading product",
            inputs: ["User interactions"],
            outputs: ["ICP and SNEED revenue to Products"],
            link: "https://swaprunner.com"
        },
        position: { x: 600, y: 750 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
];

// Define the initial edges with styles
const initialEdges = [
    // ICP Flows
    {
        id: 'e1',
        source: '1',
        target: '2',
        label: 'Maturity',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "Maturity from the 2-year neuron to Neuron Vector",
            token: "ICP",
            percentage: "100%"
        }
    },
    {
        id: 'e1b',
        source: '2',
        target: '1',
        label: 'Compound',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "ICP compounding back to the 2-year neuron",
            token: "ICP",
            percentage: "100%"
        }
    },
    {
        id: 'e2',
        source: '2',
        target: '3',
        label: '100%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "Maturity to ICP Splitter",
            token: "ICP",
            percentage: "100%"
        }
    },
    {
        id: 'e2b',
        source: '3',
        target: '2',
        label: '25%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "ICP for compounding",
            token: "ICP",
            percentage: "25%"
        }
    },
    {
        id: 'e3',
        source: '3',
        target: '4',
        label: '50%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "ICP for SNEED buyback",
            token: "ICP",
            percentage: "50%"
        }
    },
    {
        id: 'e4',
        source: '3',
        target: '6',
        label: '25%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "ICP to Treasury reserves",
            token: "ICP",
            percentage: "25%"
        }
    },

    // SNEED Flows
    {
        id: 'e5',
        source: '4',
        target: '5',
        label: '100%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "Bought SNEED to Splitter",
            token: "SNEED",
            percentage: "100%"
        }
    },
    {
        id: 'e6',
        source: '5',
        target: '6',
        label: '10%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SNEED to Treasury",
            token: "SNEED",
            percentage: "10%"
        }
    },
    {
        id: 'e7',
        source: '5',
        target: '9',
        label: '80%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SNEED to RLL Distribution",
            token: "SNEED",
            percentage: "80%"
        }
    },
    {
        id: 'e8',
        source: '5',
        target: '8',
        label: '10%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SNEED to Burn Address",
            token: "SNEED",
            percentage: "10%"
        }
    },

    // Revenue Flows
    {
        id: 'e10',
        source: '11',
        target: '10',
        label: 'LP fees',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "LP Rewards to Revenue Collector",
            token: "Various",
            percentage: "100%"
        }
    },
    {
        id: 'e11',
        source: '12',
        target: '10',
        label: 'revenue',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "Product Revenue to Collector",
            token: "Various",
            percentage: "100%"
        }
    },
    {
        id: 'e12',
        source: '10',
        target: '3',
        label: 'ICP',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "ICP Revenue to ICP Splitter",
            token: "ICP",
            percentage: "100%"
        }
    },
    {
        id: 'e12b',
        source: '10',
        target: '5',
        label: 'SNEED',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SNEED Revenue to SNEED Splitter",
            token: "SNEED",
            percentage: "100%"
        }
    },
    {
        id: 'e13',
        source: '7',
        target: '9',
        label: 'tokens',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "Tokens to RLL Distribution",
            token: "Various",
            percentage: "100%"
        }
    },
    {
        id: 'e14',
        source: '13',
        target: '12',
        label: 'fees',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SneedLock Revenue",
            token: "Various",
            percentage: "100%"
        }
    },
    {
        id: 'e15',
        source: '14',
        target: '12',
        label: 'fees',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "Swaprunner Revenue",
            token: "Various",
            percentage: "100%"
        }
    },
];

function RLLInfo() {
    const { identity, isAuthenticated, logout } = useAuth();
    const { theme } = useTheme();
    const { formatValue: denomFormatValue, convertUSD, currencySign, denomTokenSymbol } = useDenomination();
    const styles = getStyles(theme);
    // Override global styles with theme-aware versions
    const themedNodeStyles = getNodeStyles(theme);
    const themedEdgeStyles = getEdgeStyles(theme);
    const [expandedSections, setExpandedSections] = useState({
        // Main section states
        totalAssets: false,  // Collapsed by default
        rllDiagram: true,    // Expanded by default
        systemComponents: true  // Expanded by default
    });
    const [activeTab, setActiveTab] = useState('assets'); // 'assets', 'rll', 'components'
    const [expandedItems, setExpandedItems] = useState({});
    const [tooltip, setTooltip] = useState(null);
    const [treasuryBalances, setTreasuryBalances] = useState({
        icp: null,
        sneed: null
    });
    const [defiBalances, setDefiBalances] = useState({
        icp: null,
        sneed: null
    });
    const [neuronBalance, setNeuronBalance] = useState(null);
    const [isLoadingBalances, setIsLoadingBalances] = useState(true);
    const [isLoadingNeuron, setIsLoadingNeuron] = useState(true);
    const [vectorInfo, setVectorInfo] = useState({});
    const [isLoadingVectors, setIsLoadingVectors] = useState(false);
    const [lpPositions, setLpPositions] = useState({
        positions: [],
        totals: {
            token0Amount: BigInt(0),
            token1Amount: BigInt(0),
            tokensOwed0: BigInt(0),
            tokensOwed1: BigInt(0)
        }
    });
    const [isLoadingLp, setIsLoadingLp] = useState(true);
    const [conversionRates, setConversionRates] = useState({});
    const [tokenPricesLoading, setTokenPricesLoading] = useState(true);
    const [rllBalances, setRllBalances] = useState({
        icp: null,
        sneed: null
    });
    const [knownTokens, setKnownTokens] = useState([]);
    const [reconciliationData, setReconciliationData] = useState([]);
    const [isLoadingRllData, setIsLoadingRllData] = useState(true);
    const [defiKnownTokens, setDefiKnownTokens] = useState([]);
    const [defiTokenBalances, setDefiTokenBalances] = useState({});
    const [otherLpPositions, setOtherLpPositions] = useState({
        'ICP/CLOWN': {
            position: null,
            loading: true,
            error: null
        }
    });
    const [stakingStats, setStakingStats] = useState(null);
    const [isLoadingStakingStats, setIsLoadingStakingStats] = useState(true);
    const [totalSupply, setTotalSupply] = useState(null);

    // ---- live diagram: splitter ratios and destinations come from the vectors, not from the text above ----
    const NODE_LABELS = { '2': 'ICP Neuron Vector', '4': 'SNEED Buyback Vector', '6': 'Sneed DAO Treasury', '7': 'Sneed DeFi Canister', '8': 'SNEED Burn Address', '9': 'RLL Distribution' };
    const TREASURY_SUB = '8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de';
    const liveSplits = useMemo(() => {
        const toHex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
        const vectorNodeId = (hex) => (hex.length === 64 && hex.startsWith('01') ? parseInt(hex.slice(10, 12), 16) : null);
        const targetFor = (owner, sub, ledger) => {
            if (owner === '6jvpj-sqaaa-aaaaj-azwnq-cai' && vectorNodeId(sub) === 1) return '2';
            if (owner === 'togwv-zqaaa-aaaal-qr7aa-cai') return '4';
            if (owner === 'fi3zi-fyaaa-aaaaq-aachq-cai') return sub === TREASURY_SUB || ledger === 'ryjl3-tyaaa-aaaaa-aaaba-cai' ? '6' : '8';
            if (owner === 'lvc4n-7aaaa-aaaam-adm6a-cai') return '9';
            if (owner === 'ok64y-uiaaa-aaaag-qdcbq-cai') return '7';
            return null;
        };
        const out = {};
        for (const [vectorName, nodeId] of [['ICP Splitter Vector', '3'], ['SNEED Splitter Vector', '5']]) {
            const info = vectorInfo[vectorName]?.[0]?.[0];
            if (!info) continue;
            const shares = info.custom?.[0]?.devefi_split?.variables?.split || [];
            const dests = (info.destinations || []).map((d, i) => {
                const acc = d.endpoint?.ic?.account?.[0];
                const owner = acc?.owner?.toText?.() || '';
                const sub = acc?.subaccount?.[0] ? toHex(acc.subaccount[0]) : '';
                const ledger = d.endpoint?.ic?.ledger?.toText?.() || '';
                const pct = Number(shares[i] ?? parseFloat(d.name) ?? 0);
                return { owner, sub, ledger, pct, target: targetFor(owner, sub, ledger) };
            }).filter((d) => d.pct > 0);
            if (dests.length) out[nodeId] = { token: nodeId === '3' ? 'ICP' : 'SNEED', dests };
        }
        return out;
    }, [vectorInfo]);

    const liveEdges = useMemo(() => {
        const splitterIds = Object.keys(liveSplits);
        const kept = initialEdges.filter((e) => !splitterIds.includes(e.source));
        const added = [];
        for (const [src, { token, dests }] of Object.entries(liveSplits)) {
            dests.forEach((d, i) => {
                if (!d.target) return;
                added.push({
                    id: `live-${src}-${i}`, source: src, target: d.target, label: `${d.pct}%`, type: 'smoothstep',
                    style: token === 'ICP' ? edgeStyles.icp : edgeStyles.sneed, markerEnd: { type: MarkerType.ArrowClosed },
                    data: { description: `${d.pct}% ${token} to ${NODE_LABELS[d.target] || d.owner} (read from the vector)`, token, percentage: `${d.pct}%` },
                });
            });
        }
        return [...kept, ...added];
    }, [liveSplits]);

    const liveText = useMemo(() => {
        // outputs per splitter and inputs per destination, as the vectors say today
        const outputs = {}; const inputs = {};
        for (const [src, { token, dests }] of Object.entries(liveSplits)) {
            outputs[src] = dests.map((d) => `${d.pct}% ${token} to ${d.target ? NODE_LABELS[d.target] : d.owner}`);
            for (const d of dests) if (d.target) (inputs[d.target] = inputs[d.target] || []).push(`${token} from ${src === '3' ? 'ICP Splitter' : 'SNEED Splitter'} (${d.pct}%)`);
        }
        return { outputs, inputs };
    }, [liveSplits]);

    const neuronDescription = neuronBalance
        ? `Long-term ICP staking neuron, dissolve delay ${formatDurationStatic(Number(neuronBalance.dissolve_delay_seconds))}${neuronBalance.state === 1 ? ' (not dissolving)' : ' (dissolving)'}`
        : null;

    const patchItem = (item) => {
        const id = String(item.id);
        const out = { ...item };
        if (liveText.outputs[id]) out.outputs = liveText.outputs[id];
        if (liveText.inputs[id]) out.inputs = [...liveText.inputs[id], ...(item.inputs || []).filter((x) => !/Splitter/.test(x))];
        if (id === '1' && neuronDescription) out.description = neuronDescription;
        return out;
    };
    const nodeKind = (n) => (n.style === nodeStyles.infrastructure ? 'infrastructure' : n.style === nodeStyles.revenue ? 'revenue' : 'tokenManagement');
    const liveNodes = useMemo(() => initialNodes.map((n) => ({ ...n, style: themedNodeStyles[nodeKind(n)], data: patchItem({ ...n.data, id: n.id }) })), [liveText, neuronDescription, theme]); // eslint-disable-line react-hooks/exhaustive-deps

    // The Token Flows list says what the vectors say today, like the diagram does
    const liveFlowSections = useMemo(() => Object.fromEntries(Object.entries(edges).map(([key, section]) => {
        const kept = section.items.filter((e) => !liveSplits[e.source]);
        const added = [];
        for (const [src, { token, dests }] of Object.entries(liveSplits)) {
            if ((key === 'icpFlows') !== (token === 'ICP')) continue;
            dests.forEach((d, i) => {
                if (!d.target) return;
                added.push({ id: `flow-${src}-${i}`, source: src, target: d.target, description: `${token} to ${NODE_LABELS[d.target]}`, token, percentage: `${d.pct}%`, live: true });
            });
        }
        return [key, { ...section, items: [...kept, ...added] }];
    })), [liveSplits]); // eslint-disable-line react-hooks/exhaustive-deps
    const nodeTitle = (id) => initialNodes.find((n) => n.id === id)?.data.label || id;
    const liveSections = useMemo(() => Object.fromEntries(Object.entries(nodes).map(([k, section]) => [k, { ...section, items: section.items.map(patchItem) }])), [liveText, neuronDescription]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch prices for all known tokens
    useEffect(() => {
        const fetchAllTokenPrices = async () => {
            if (knownTokens.length === 0 && defiKnownTokens.length === 0) {
                return; // Wait for tokens to be loaded
            }

            setTokenPricesLoading(true);
            try {
                // Collect all unique tokens from both sources
                const allTokens = new Map();
                
                // Add RLL tokens
                knownTokens.forEach(([tokenId, tokenInfo]) => {
                    const id = tokenId.toString();
                    allTokens.set(id, {
                        symbol: tokenInfo.symbol,
                        decimals: Number(tokenInfo.decimals)
                    });
                });
                
                // Add DeFi tokens
                defiKnownTokens.forEach(([tokenId, tokenInfo]) => {
                    const id = tokenId.toString();
                    allTokens.set(id, {
                        symbol: tokenInfo.symbol,
                        decimals: Number(tokenInfo.decimals)
                    });
                });

                // Add CLOWN (Insane Clown Protocol) manually: the DeFi canister holds CLOWN/ICP positions
                allTokens.set('iwv6l-6iaaa-aaaal-ajjjq-cai', {
                    symbol: 'CLOWN',
                    decimals: 8
                });

                console.log('[RLLInfo] Attempting to fetch prices for tokens:', 
                    Array.from(allTokens.entries()).map(([id, info]) => `${info.symbol} (${id})`));

                // Fetch prices for all tokens in parallel
                const pricePromises = Array.from(allTokens.entries()).map(async ([tokenId, tokenInfo]) => {
                    try {
                        console.log(`[RLLInfo] Fetching price for ${tokenInfo.symbol} (${tokenId})...`);
                        const price = await priceService.getTokenUSDPrice(tokenId, tokenInfo.decimals);
                        console.log(`[RLLInfo] ✓ ${tokenInfo.symbol}: $${price.toFixed(4)}`);
                        return [tokenInfo.symbol, price];
                    } catch (error) {
                        console.warn(`[RLLInfo] ✗ Failed to fetch price for ${tokenInfo.symbol} (${tokenId}):`, error.message);
                        return [tokenInfo.symbol, 0];
                    }
                });

                const prices = await Promise.all(pricePromises);
                const ratesMap = Object.fromEntries(prices);
                
                // Log summary
                const successCount = Object.values(ratesMap).filter(p => p > 0).length;
                const failCount = Object.values(ratesMap).filter(p => p === 0).length;
                console.log(`[RLLInfo] Price fetch complete: ${successCount} succeeded, ${failCount} failed`);
                console.log('[RLLInfo] Final conversion rates:', ratesMap);
                
                setConversionRates(ratesMap);
            } catch (error) {
                console.error('Error fetching token prices:', error);
            } finally {
                setTokenPricesLoading(false);
            }
        };

        fetchAllTokenPrices();
        
        // Refresh prices every 5 minutes
        const interval = setInterval(fetchAllTokenPrices, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [knownTokens, defiKnownTokens]);

    // Helper function to calculate USD value
    const getUSDValue = (amount, decimals, symbol) => {
        if (!amount) return 0;
        const value = Number(amount) / Math.pow(10, decimals);
        const rate = conversionRates[symbol] || 0;
        const usdValue = value * rate;
        
        // Cap suspicious values at calculation level (not just display)
        if (!isFinite(usdValue) || usdValue > 1e15) {
            console.warn(`[RLLInfo] Suspicious USD value for ${symbol} - capping to 0:`, {
                amount: amount.toString(),
                decimals,
                tokenValue: value,
                rate,
                usdValue
            });
            return 0; // Return 0 for overflow values
        }
        
        return usdValue;
    };

    const formatUSD = (value) => {
        if (!isFinite(value) || value > 1e15 || value < 0) {
            return denomFormatValue(0);
        }
        return denomFormatValue(value);
    };

    // A unit price in the user's denomination, with enough digits for a small token
    const formatPrice = (usd) => {
        if (usd == null || !isFinite(usd)) return '…';
        const d = convertUSD(usd);
        if (d == null) return '…';
        const digits = Number(d).toLocaleString(undefined, { maximumSignificantDigits: 4 });
        return currencySign ? `${currencySign}${digits}` : `${digits} ${denomTokenSymbol || ''}`.trim();
    };

    // Update the neuron balance fetching effect
    useEffect(() => {
        const fetchNeuronBalance = async () => {
            setIsLoadingNeuron(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                
                const governanceCanister = createNnsGovActor('rrkah-fqaaa-aaaaa-aaaaq-cai', {
                    agentOptions: { agent }
                });

                // Pass the neuron ID directly as a BigInt
                const neuronId = BigInt('4000934039483276792');
                const neuronInfo = await governanceCanister.get_neuron_info(neuronId);

                if ('Ok' in neuronInfo) {
                    setNeuronBalance(neuronInfo.Ok);
                    console.log('Neuron info:', neuronInfo.Ok);
                } else if ('Error' in neuronInfo) {
                    console.error('Error from governance canister:', neuronInfo.Error);
                }
            } catch (error) {
                console.error('Error fetching neuron balance:', error);
            } finally {
                setIsLoadingNeuron(false);
            }
        };

        fetchNeuronBalance();
    }, []);

    // Update effect to show loading state
    useEffect(() => {
        const fetchTreasuryBalances = async () => {
            setIsLoadingBalances(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });

                // ICP Treasury balance
                const icpLedgerActor = createLedgerActor('ryjl3-tyaaa-aaaaa-aaaba-cai', {
                    agentOptions: { agent }
                });
                const icpBalance = await icpLedgerActor.icrc1_balance_of({
                    owner: Principal.fromText('fi3zi-fyaaa-aaaaq-aachq-cai'),
                    subaccount: []  // Main account
                });

                // SNEED Treasury balance
                const sneedLedgerActor = createLedgerActor('hvgxa-wqaaa-aaaaq-aacia-cai', {
                    agentOptions: { agent }
                });
                const sneedBalance = await sneedLedgerActor.icrc1_balance_of({
                    owner: Principal.fromText('fi3zi-fyaaa-aaaaq-aachq-cai'),
                    subaccount: [
                        hexToUint8Array('8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de')
                    ]
                });

                // DeFi Canister balances
                const defiIcpBalance = await icpLedgerActor.icrc1_balance_of({
                    owner: Principal.fromText('ok64y-uiaaa-aaaag-qdcbq-cai'),
                    subaccount: []
                });

                const defiSneedBalance = await sneedLedgerActor.icrc1_balance_of({
                    owner: Principal.fromText('ok64y-uiaaa-aaaag-qdcbq-cai'),
                    subaccount: []
                });

                setTreasuryBalances({
                    icp: icpBalance,
                    sneed: sneedBalance
                });

                setDefiBalances({
                    icp: defiIcpBalance,
                    sneed: defiSneedBalance
                });
            } catch (error) {
                console.error('Error fetching balances:', error);
            } finally {
                setIsLoadingBalances(false);
            }
        };

        fetchTreasuryBalances();
    }, []);

    // Add effect to fetch vector information
    useEffect(() => {
        const fetchVectorInfo = async () => {
            setIsLoadingVectors(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });

                // Create actors for each vector
                const vectors = {
                    'ICP Neuron Vector': {
                        id: '6jvpj-sqaaa-aaaaj-azwnq-cai',
                        nodeId: 1, // Local node ID in the vector system
                        useExchange: false
                    },
                    'ICP Splitter Vector': {
                        id: '6jvpj-sqaaa-aaaaj-azwnq-cai',
                        nodeId: 6,
                        useExchange: false
                    },
                    'SNEED Splitter Vector': {
                        id: '6jvpj-sqaaa-aaaaj-azwnq-cai',
                        nodeId: 45,
                        useExchange: false
                    },
                    'SNEED Buyback Vector': {
                        id: 'togwv-zqaaa-aaaal-qr7aa-cai',
                        nodeId: 18,
                        useExchange: true
                    }
                };

                const vectorData = {};
                
                for (const [name, vector] of Object.entries(vectors)) {
                    const actor = vector.useExchange ? 
                        createExVectorActor(vector.id, { agentOptions: { agent } }) :
                        createVectorActor(vector.id, { agentOptions: { agent } });

                    // Fetch node information
                    const nodes = await actor.icrc55_get_nodes([{ id: vector.nodeId }]);
                    if (nodes && nodes.length > 0) {
                        vectorData[name] = nodes;
                        console.log(`Vector info for ${name}:`, nodes);
                    }
                }

                setVectorInfo(vectorData);
            } catch (error) {
                console.error('Error fetching vector information:', error);
            } finally {
                setIsLoadingVectors(false);
            }
        };

        fetchVectorInfo();
    }, []);

    // Update effect to fetch LP positions
    useEffect(() => {
        const fetchLpPositions = async () => {
            setIsLoadingLp(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });

                const swapCanisterId = 'osyzs-xiaaa-aaaag-qc76q-cai';
                const swapActor = createIcpSwapActor(swapCanisterId, {
                    agentOptions: { agent }
                });
                
                // Every position the Sneed DeFi canister holds in the SNEED/ICP pool
                const [allPositions, mine] = await Promise.all([
                    swapActor.getUserPositionWithTokenAmount(0, 500),
                    swapActor.getUserPositionsByPrincipal(Principal.fromText('ok64y-uiaaa-aaaag-qdcbq-cai')),
                ]);
                const positions = [];
                if (allPositions.ok && mine.ok) {
                    const ids = new Set(mine.ok.map(p => Number(p.id)));
                    for (const position of allPositions.ok.content) {
                        if (ids.has(Number(position.id))) positions.push(position);
                    }
                    positions.sort((a, b) => Number(b.liquidity || 0) - Number(a.liquidity || 0));
                }

                // Calculate totals
                const totals = positions.reduce((acc, pos) => {
                    acc.token0Amount += BigInt(pos.token0Amount || 0);
                    acc.token1Amount += BigInt(pos.token1Amount || 0);
                    acc.tokensOwed0 += BigInt(pos.tokensOwed0 || 0);
                    acc.tokensOwed1 += BigInt(pos.tokensOwed1 || 0);
                    return acc;
                }, {
                    token0Amount: BigInt(0),  // SNEED
                    token1Amount: BigInt(0),  // ICP
                    tokensOwed0: BigInt(0),   // Unclaimed SNEED
                    tokensOwed1: BigInt(0)    // Unclaimed ICP
                });

                setLpPositions({
                    positions,
                    totals
                });
            } catch (error) {
                console.error('Error fetching LP positions:', error);
            } finally {
                setIsLoadingLp(false);
            }
        };

        fetchLpPositions();
    }, []);

    // Add effect to fetch RLL token data
    useEffect(() => {
        const fetchRllTokenData = async () => {
            setIsLoadingRllData(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });

                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });
                
                // First get known tokens
                const tokens = await rllActor.get_known_tokens();
                setKnownTokens(tokens);
                console.log('Known tokens:', tokens);

                // Get total distributions
                const totalDistributions = await rllActor.get_total_distributions();
                const distributionsMap = Object.fromEntries(
                    totalDistributions.map(([tokenId, amount]) => [tokenId.toString(), amount])
                );

                // For each token, get its balance
                const balances = await Promise.all(tokens.map(async ([tokenId]) => {
                    const ledgerActor = createLedgerActor(tokenId.toString(), {
                        agentOptions: { agent }
                    });
                    const balance = await ledgerActor.icrc1_balance_of({
                        owner: Principal.fromText(rllCanisterId),
                        subaccount: []
                    });
                    return [tokenId, balance];
                }));

                // Call balance_reconciliation_from_balances
                const reconciliation = await rllActor.balance_reconciliation_from_balances(balances);
                console.log('Reconciliation data:', reconciliation);
                
                // Enhance reconciliation data with total distributions
                const enhancedReconciliation = reconciliation.map(item => ({
                    ...item,
                    total_distributed: distributionsMap[item.token_id.toString()] || BigInt(0)
                }));
                
                setReconciliationData(enhancedReconciliation);

                // Update RLL balances state with ICP and SNEED
                const icpBalance = balances.find(([tokenId]) => 
                    tokenId.toString() === 'ryjl3-tyaaa-aaaaa-aaaba-cai')?.[1] || null;
                const sneedBalance = balances.find(([tokenId]) => 
                    tokenId.toString() === 'hvgxa-wqaaa-aaaaq-aacia-cai')?.[1] || null;
                
                setRllBalances({
                    icp: icpBalance,
                    sneed: sneedBalance
                });

            } catch (error) {
                console.error('Error fetching RLL token data:', error);
            } finally {
                setIsLoadingRllData(false);
            }
        };

        fetchRllTokenData();
    }, []);

    // Add effect to fetch DeFi canister known tokens and balances
    useEffect(() => {
        const fetchDefiTokens = async () => {
            setIsLoadingRllData(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });

                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });
                
                // Get known tokens for DeFi canister
                const tokens = await rllActor.get_wallet_known_tokens(Principal.fromText("ok64y-uiaaa-aaaag-qdcbq-cai"));
                setDefiKnownTokens(tokens);

                // Get balance for each token
                const balances = await Promise.all(tokens.map(async ([tokenId]) => {
                    const ledgerActor = createLedgerActor(tokenId.toString(), {
                        agentOptions: { agent }
                    });
                    const balance = await ledgerActor.icrc1_balance_of({
                        owner: Principal.fromText("ok64y-uiaaa-aaaag-qdcbq-cai"),
                        subaccount: []
                    });
                    return [tokenId.toString(), balance];
                }));

                setDefiTokenBalances(Object.fromEntries(balances));
            } catch (error) {
                console.error('Error fetching DeFi token data:', error);
            } finally {
                setIsLoadingRllData(false);
            }
        };

        fetchDefiTokens();
    }, []);

    // Add helper function to convert hex to Uint8Array
    const hexToUint8Array = (hex) => {
        const pairs = hex.match(/[\dA-F]{2}/gi);
        const integers = pairs.map(s => parseInt(s, 16));
        return new Uint8Array(integers);
    };

    // Add helper function to convert Uint8Array to hex
    const uint8ArrayToHex = (array) => {
        return Array.from(array)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    };

    // Update tooltip content to show loading state
    const renderTreasuryBalances = () => (
        <div style={{
            marginTop: '8px',
            padding: '8px',
            backgroundColor: theme.colors.tertiaryBg,
            borderRadius: '4px'
        }}>
            <div style={{ marginBottom: '4px' }}>Current Balances:</div>
            {isLoadingBalances ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                    <div style={styles.spinner} />
                </div>
            ) : (
                <>
                    <div>ICP: {(Number(treasuryBalances.icp) / 1e8).toFixed(2)} ICP</div>
                    <div>SNEED: {(Number(treasuryBalances.sneed) / 1e8).toFixed(2)} SNEED</div>
                </>
            )}
        </div>
    );

    // Add helper function to format duration
    const formatDuration = (seconds) => {
        if (!seconds) return '0 seconds';
        const years = Math.floor(seconds / (365 * 24 * 60 * 60));
        const months = Math.floor((seconds % (365 * 24 * 60 * 60)) / (30 * 24 * 60 * 60));
        const days = Math.floor((seconds % (30 * 24 * 60 * 60)) / (24 * 60 * 60));
        
        const parts = [];
        if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
        if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
        if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
        
        return parts.join(', ') || '< 1 day';
    };

    // Add helper function to get token symbol from ledger ID
    const getTokenSymbolFromLedger = (ledgerId) => {
        const tokenMap = {
            'ryjl3-tyaaa-aaaaa-aaaba-cai': 'ICP',
            'hvgxa-wqaaa-aaaaq-aacia-cai': 'SNEED'
        };
        return tokenMap[ledgerId.toString()] || 'Unknown';
    };

    // Add helper function to format ICRC1 account
    const formatIcrc1Account = (account) => {
        if (!account) return 'Unknown';
        
        try {
            // For destinations, the structure is endpoint.ic.account[0]
            if (account.ic && account.ic.account && Array.isArray(account.ic.account)) {
                const acc = account.ic.account[0];
                if (!acc || !acc.owner) return 'Unknown';
                return encodeIcrcAccount({
                    owner: acc.owner,
                    subaccount: acc.subaccount?.[0]
                });
            }
            
            // For sources, the structure is endpoint.ic.account
            if (account.ic && account.ic.account && account.ic.account.owner) {
                return encodeIcrcAccount({
                    owner: account.ic.account.owner,
                    subaccount: account.ic.account.subaccount?.[0]
                });
            }
            
            // Fallback for direct account structure
            if (account.owner) {
                return encodeIcrcAccount({
                    owner: account.owner,
                    subaccount: account.subaccount?.[0]
                });
            }
        } catch (error) {
            console.error('Error formatting ICRC1 account:', error);
        }
        
        return 'Unknown';
    };

    // Add helper function to get node name from account and token
    const getNodeNameFromAccount = (account, tokenId) => {
        if (!account) return '';
        
        try {
            const formattedAccount = formatIcrc1Account(account);
            
            // Special case for fi3zi-fyaaa-aaaaq-aachq-cai accounts
            if (formattedAccount.startsWith('fi3zi-fyaaa-aaaaq-aachq-cai')) {
                // SNEED Treasury has a specific subaccount
                if (formattedAccount.includes('8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de')) {
                    return 'Sneed DAO Treasury';
                }
                // For SNEED token without the treasury subaccount, it's the burn address
                if (tokenId.toString() === 'hvgxa-wqaaa-aaaaq-aacia-cai') {
                    return 'SNEED Burn Address';
                }
                // For ICP token it's the treasury
                if (tokenId.toString() === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
                    return 'Sneed DAO Treasury';
                }
            }

            // Map other known accounts to node names
            const nodeMapping = {
                '6jvpj-sqaaa-aaaaj-azwnq-cai-wu6phoy': 'ICP Neuron Vector',
                '6jvpj-sqaaa-aaaaj-azwnq-cai-m7u3kpi': 'ICP Splitter Vector',
                '6jvpj-sqaaa-aaaaj-azwnq-cai-vilbrxq': 'SNEED Splitter Vector',
                'togwv-zqaaa-aaaal-qr7aa-cai-ihr3xbq': 'SNEED Buyback Vector',
                'ok64y-uiaaa-aaaag-qdcbq-cai': 'Sneed DeFi Canister',
                'lvc4n-7aaaa-aaaam-adm6a-cai': 'RLL Distribution'
            };

            // Try to find a matching node name
            for (const [accountPrefix, nodeName] of Object.entries(nodeMapping)) {
                if (formattedAccount.startsWith(accountPrefix)) {
                    return nodeName;
                }
            }
        } catch (error) {
            console.error('Error getting node name:', error);
        }
        
        return '';
    };

    // Update renderVectorInfo to include node names
    const renderVectorInfo = (vectorName) => {
        if (isLoadingVectors) {
            return (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                    <div style={styles.spinner} />
                </div>
            );
        }

        const info = vectorInfo[vectorName]?.[0]?.[0];
        if (!info) return null;

        return (
            <div style={{
                marginTop: '8px',
                padding: '8px',
                backgroundColor: theme.colors.tertiaryBg,
                borderRadius: '4px'
            }}>
                <div style={{ marginBottom: '4px' }}>Vector Status:</div>
                <div style={styles.statusItem}>
                    <span>Active:</span>
                    <span>{info.active ? 'true' : 'false'}</span>
                </div>
                <div style={styles.statusItem}>
                    <span>Created:</span>
                    <span>{formatNanoTimestamp(info.created)}</span>
                </div>
                <div style={styles.statusItem}>
                    <span>Last Modified:</span>
                    <span>{formatNanoTimestamp(info.modified)}</span>
                </div>
                {vectorName === 'SNEED Buyback Vector' && info.custom?.[0]?.exchange && (
                    <>
                        <div style={styles.statusItem}>
                            <span>Rate:</span>
                            <span>{info.custom[0].exchange.internals.current_rate?.[0]?.toFixed(8) || 'N/A'} ICP/SNEED</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Next Buy:</span>
                            <span>{formatNanoTimestamp(info.custom[0].exchange.internals.next_buy)}</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Buy Amount:</span>
                            <span>{(Number(info.custom[0].exchange.variables.buy_for_amount) / 1e8).toFixed(2)} ICP</span>
                        </div>
                        <div style={styles.statusItem}>
                            <span>Balance:</span>
                            <span>{(Number(info.sources?.[0]?.balance || 0) / 1e8).toFixed(2)} ICP</span>
                        </div>
                    </>
                )}
                {/* Sources */}
                {info.sources && info.sources.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                        <div style={{ marginBottom: '4px' }}>Sources:</div>
                        {info.sources.map((source, idx) => {
                            const nodeName = getNodeNameFromAccount(source.endpoint, source.endpoint.ic.ledger);
                            return (
                                <div key={idx} style={{ marginLeft: '8px', marginBottom: '8px' }}>
                                    • {source.name || 'Default'}: {(Number(source.balance) / 1e8).toFixed(8)} {getTokenSymbolFromLedger(source.endpoint.ic.ledger)}
                                    <div style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                        Account: 
                                        <div style={{
                                            display: 'inline-block',
                                            maxWidth: '100%',
                                            wordBreak: 'break-all',
                                            fontFamily: 'monospace',
                                            fontSize: '0.9em',
                                            background: theme.colors.tertiaryBg,
                                            padding: '2px 4px',
                                            borderRadius: '3px',
                                            margin: '2px 0'
                                        }}>
                                            {formatIcrc1Account(source.endpoint)}
                                        </div>
                                        {nodeName && <span style={{ color: theme.colors.accent }}> ({nodeName})</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {/* Destinations */}
                {info.destinations && info.destinations.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                        <div style={{ marginBottom: '4px' }}>Destinations:</div>
                        {info.destinations.map((dest, idx) => {
                            const nodeName = getNodeNameFromAccount(dest.endpoint, dest.endpoint.ic.ledger);
                            return (
                                <div key={idx} style={{ marginLeft: '8px', marginBottom: '8px' }}>
                                    • {dest.name}% {getTokenSymbolFromLedger(dest.endpoint.ic.ledger)}
                                    <div style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                        Account: 
                                        <div style={{
                                            display: 'inline-block',
                                            maxWidth: '100%',
                                            wordBreak: 'break-all',
                                            fontFamily: 'monospace',
                                            fontSize: '0.9em',
                                            background: theme.colors.tertiaryBg,
                                            padding: '2px 4px',
                                            borderRadius: '3px',
                                            margin: '2px 0'
                                        }}>
                                            {formatIcrc1Account(dest.endpoint)}
                                        </div>
                                        {nodeName && <span style={{ color: theme.colors.accent }}> ({nodeName})</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    // Update renderItemDetails to include LP position details
    const renderItemDetails = (item) => (
        <div style={styles.itemContent}>
            <p>{item.description}</p>
            <h4>Inputs:</h4>
            <ul style={styles.list}>
                {item.inputs.map((input, i) => (
                    <li key={i}>{input}</li>
                ))}
            </ul>
            <h4>Outputs:</h4>
            <ul style={styles.list}>
                {item.outputs.map((output, i) => (
                    <li key={i}>{output}</li>
                ))}
            </ul>
            <div style={styles.detailsSection}>
                {item.canisterId && (
                    <p>Canister ID: <span className="long-account-string">{item.canisterId}</span></p>
                )}
                {item.icrc1Account && (
                    <p>ICRC1 Account: <span className="long-account-string">{item.icrc1Account}</span></p>
                )}
                {item.details && (
                    <div style={{ marginTop: '10px' }}>
                        {item.details.split('\n').map((line, i) => {
                            if (line.includes('ICRC1 Account') || line.includes('ICP Account')) {
                                const parts = line.split(/(ICRC1 Account |, ICP Account )/);
                                return (
                                    <div key={i} style={{ marginBottom: '10px' }}>
                                        {parts.map((part, j) => {
                                            if (part === 'ICRC1 Account ' || part === ', ICP Account ') {
                                                return <span key={j}>{part}</span>;
                                            }
                                            return <span key={j} className="long-account-string">{part}</span>;
                                        })}
                                    </div>
                                );
                            }
                            return <div key={i} style={{ marginBottom: '10px' }}>{line}</div>;
                        })}
                    </div>
                )}
                {item.id === '6' && (
                    <div style={{
                        marginTop: '15px',
                        padding: '15px',
                        background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                        borderRadius: '6px'
                    }}>
                        <h4 style={{ margin: '0 0 15px 0' }}>Current Balances</h4>
                        {isLoadingBalances ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : treasuryBalances ? (
                            <>
                                <div style={styles.statusItem}>
                                    <span>ICP:</span>
                                    <span>
                                        {(Number(treasuryBalances.icp) / 1e8).toFixed(4)} ICP
                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                            ({formatUSD(getUSDValue(treasuryBalances.icp, 8, 'ICP'))})
                                        </span>
                                    </span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>SNEED:</span>
                                    <span>
                                        {(Number(treasuryBalances.sneed) / 1e8).toFixed(4)} SNEED
                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                            ({formatUSD(getUSDValue(treasuryBalances.sneed, 8, 'SNEED'))})
                                        </span>
                                    </span>
                                </div>
                            </>
                        ) : (
                            <div>Failed to load treasury balances</div>
                        )}
                    </div>
                )}
                {item.id === '1' && (
                    <div style={{
                        marginTop: '15px',
                        padding: '15px',
                        background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                        borderRadius: '6px'
                    }}>
                        <h4 style={{ margin: '0 0 15px 0' }}>Current Status</h4>
                        {isLoadingNeuron ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : neuronBalance ? (
                            <>
                                <div style={styles.statusItem}>
                                    <span>Stake:</span>
                                    <span>{(Number(neuronBalance.stake_e8s) / 1e8).toFixed(2)} ICP</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>Voting Power:</span>
                                    <span>{(Number(neuronBalance.voting_power) / 1e8).toFixed(2)} VP</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>Age:</span>
                                    <span>{formatDuration(Number(neuronBalance.age_seconds))}</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>Dissolve Delay:</span>
                                    <span>{formatDuration(Number(neuronBalance.dissolve_delay_seconds))}</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>State:</span>
                                    <span>{neuronBalance.state === 1 ? 'Not Dissolving' : 'Dissolving'}</span>
                                </div>
                            </>
                        ) : (
                            <div>Failed to load neuron information</div>
                        )}
                    </div>
                )}
                {item.id === '11' && (
                    <div style={{
                        marginTop: '10px',
                        padding: '10px',
                        background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                        borderRadius: '4px'
                    }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>LP Positions:</h4>
                        {isLoadingLp ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : lpPositions.positions.length > 0 ? (
                            lpPositions.positions.map((position, index) => (
                                <div key={index} style={{
                                    marginBottom: '15px',
                                    padding: '10px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                    borderRadius: '4px'
                                }}>
                                    <div style={{ color: theme.colors.accent, marginBottom: '5px' }}>Position #{Number(position.id)}:</div>
                                    <div style={{ marginLeft: '10px' }}>
                                        <div>Current Position:</div>
                                        <div>• {(Number(position.token0Amount) / 1e8).toFixed(4)} SNEED</div>
                                        <div>• {(Number(position.token1Amount) / 1e8).toFixed(4)} ICP</div>
                                        <div style={{ marginTop: '5px' }}>Unclaimed Rewards:</div>
                                        <div>• {(Number(position.tokensOwed0) / 1e8).toFixed(4)} SNEED</div>
                                        <div>• {(Number(position.tokensOwed1) / 1e8).toFixed(4)} ICP</div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div>No LP positions found</div>
                        )}
                    </div>
                )}
                {item.id === '7' && (
                    <div style={{
                        marginTop: '10px',
                        padding: '10px',
                        background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                        borderRadius: '4px'
                    }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>Current Balances:</h4>
                        {isLoadingBalances ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : (
                            <div style={{ marginLeft: '10px' }}>
                                <div>• {(Number(defiBalances.icp) / 1e8).toFixed(4)} ICP</div>
                                <div>• {(Number(defiBalances.sneed) / 1e8).toFixed(4)} SNEED</div>
                            </div>
                        )}
                    </div>
                )}
                {(item.id === '2' || item.id === '3' || item.id === '5' || item.id === '4') && (
                    <div style={{
                        marginTop: '10px',
                        padding: '10px',
                        background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                        borderRadius: '4px'
                    }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>Vector Status:</h4>
                        {renderVectorInfo(
                            item.id === '2' ? 'ICP Neuron Vector' :
                            item.id === '3' ? 'ICP Splitter Vector' :
                            item.id === '4' ? 'SNEED Buyback Vector' :
                            'SNEED Splitter Vector'
                        )}
                    </div>
                )}
                {item.id === "9" && (
                    <div style={{
                        marginTop: '15px',
                        padding: '15px',
                        background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                        borderRadius: '6px'
                    }}>
                        <h4 style={{ margin: '0 0 15px 0', color: theme.colors.accent }}>Token Balances and Reconciliation</h4>
                        {isLoadingRllData ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : (
                            knownTokens.map(([tokenId, tokenInfo]) => {
                                const reconciliation = reconciliationData.find(item => 
                                    item.token_id.toString() === tokenId.toString()
                                );
                                if (!reconciliation) return null;

                                return (
                                    <div key={tokenId.toString()} style={{
                                        marginBottom: '15px',
                                        padding: '10px',
                                        background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                                        borderRadius: '4px'
                                    }}>
                                        <div style={{ color: theme.colors.accent, marginBottom: '8px', fontWeight: 'bold' }}>
                                            Token: {tokenInfo.symbol}
                                        </div>
                                        <div style={{ marginLeft: '10px' }}>
                                            <div>All-Time Distributed: {(Number(reconciliation.total_distributed) / Math.pow(10, tokenInfo.decimals)).toFixed(8)} {tokenInfo.symbol}</div>
                                            <div>Currently Claimable: {(Number(reconciliation.local_total) / Math.pow(10, tokenInfo.decimals)).toFixed(8)} {tokenInfo.symbol}</div>
                                            <div>Server Balance: {(Number(reconciliation.server_balance) / Math.pow(10, tokenInfo.decimals)).toFixed(8)} {tokenInfo.symbol}</div>
                                            <div style={{ color: Number(reconciliation.remaining) > 0 ? theme.colors.success : theme.colors.primaryText }}>
                                                Remaining: {(Number(reconciliation.remaining) / Math.pow(10, tokenInfo.decimals)).toFixed(8)} {tokenInfo.symbol}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    // Helper function for nanosecond timestamps
    const formatNanoTimestamp = (nanoTimestamp) => {
        if (!nanoTimestamp) return 'Unknown';
        // Convert from nanoseconds to milliseconds
        const milliseconds = Number(nanoTimestamp) / 1_000_000;
        return new Date(milliseconds).toLocaleString();
    };

    // What the card for a node says (hover and pinned alike)
    const buildNodeContent = (node) => {
        const content = (
            <div>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: theme.colors.accent }}>{node.data.label}</div>
                <div style={{ marginBottom: '8px' }}>{node.data.description}</div>
                {node.data.inputs && (
                    <div>
                        <div style={{ color: theme.colors.success, marginBottom: '4px' }}>Inputs:</div>
                        <ul style={{ margin: '0 0 8px 16px', padding: 0 }}>
                            {node.data.inputs.map((input, i) => (
                                <li key={i}>{input}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {node.data.outputs && (
                    <div>
                        <div style={{ color: theme.colors.error, marginBottom: '4px' }}>Outputs:</div>
                        <ul style={{ margin: '0 0 8px 16px', padding: 0 }}>
                            {node.data.outputs.map((output, i) => (
                                <li key={i}>{output}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {node.data.canisterId && (
                    <div style={{ 
                        fontFamily: 'monospace', 
                        fontSize: '11px', 
                        color: theme.colors.mutedText,
                        marginTop: '8px'
                    }}>
                        Canister ID: {node.data.canisterId}
                    </div>
                )}
                {node.id === '1' && neuronBalance && (
                    <div style={{
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: theme.colors.tertiaryBg,
                        borderRadius: '4px'
                    }}>
                        <div style={{ marginBottom: '4px' }}>Current Status:</div>
                        {isLoadingNeuron ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : (
                            <>
                                <div style={styles.statusItem}>
                                    <span>Stake:</span>
                                    <span>{(Number(neuronBalance.stake_e8s) / 1e8).toFixed(2)} ICP</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>Voting Power:</span>
                                    <span>{(Number(neuronBalance.voting_power) / 1e8).toFixed(2)} VP</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>Age:</span>
                                    <span>{formatDuration(Number(neuronBalance.age_seconds))}</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>Dissolve Delay:</span>
                                    <span>{formatDuration(Number(neuronBalance.dissolve_delay_seconds))}</span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>State:</span>
                                    <span>{neuronBalance.state === 1 ? 'Not Dissolving' : 'Dissolving'}</span>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {node.data.label === 'Sneed DAO Treasury' && renderTreasuryBalances()}
                {node.id === '2' && renderVectorInfo('ICP Neuron Vector')}
                {node.id === '3' && renderVectorInfo('ICP Splitter Vector')}
                {node.id === '4' && (
                    <div style={{
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: theme.colors.tertiaryBg,
                        borderRadius: '4px'
                    }}>
                        <div style={{ marginBottom: '4px' }}>Exchange Status:</div>
                        {isLoadingVectors ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : (
                            <>
                                {vectorInfo['SNEED Buyback Vector']?.[0]?.[0]?.custom?.[0]?.exchange && (
                                    <>
                                        <div>Rate: {vectorInfo['SNEED Buyback Vector'][0][0].custom[0].exchange.internals.current_rate?.[0]?.toFixed(8) || 'N/A'} ICP/SNEED</div>
                                        <div>Next Buy: {formatNanoTimestamp(vectorInfo['SNEED Buyback Vector'][0][0].custom[0].exchange.internals.next_buy)}</div>
                                        <div>Buy Amount: {(Number(vectorInfo['SNEED Buyback Vector'][0][0].custom[0].exchange.variables.buy_for_amount) / 1e8).toFixed(2)} ICP</div>
                                        <div>Balance: {(Number(vectorInfo['SNEED Buyback Vector'][0][0].sources?.[0]?.balance || 0) / 1e8).toFixed(2)} ICP</div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
                {node.id === '5' && renderVectorInfo('SNEED Splitter Vector')}
                {node.data.details && (
                    <div style={{ marginTop: '10px' }}>
                        {node.data.details.split('\n').map((line, i) => (
                            <div key={i} style={{ marginBottom: '10px' }}>{line}</div>
                        ))}
                    </div>
                )}
                {node.id === '11' && (
                    <div style={{
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: theme.colors.tertiaryBg,
                        borderRadius: '4px'
                    }}>
                        <div style={{ marginBottom: '4px' }}>Total LP Position Status:</div>
                        {isLoadingLp ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : lpPositions.totals ? (
                            <>
                                <div style={{ color: theme.colors.accent }}>Total Current Position:</div>
                                <div>• {(Number(lpPositions.totals.token0Amount) / 1e8).toFixed(4)} SNEED</div>
                                <div>• {(Number(lpPositions.totals.token1Amount) / 1e8).toFixed(4)} ICP</div>
                                <div style={{ color: theme.colors.success, marginTop: '8px' }}>Total Unclaimed Rewards:</div>
                                <div>• {(Number(lpPositions.totals.tokensOwed0) / 1e8).toFixed(4)} SNEED</div>
                                <div>• {(Number(lpPositions.totals.tokensOwed1) / 1e8).toFixed(4)} ICP</div>
                            </>
                        ) : (
                            <div>Failed to load LP positions</div>
                        )}
                    </div>
                )}
                {node.id === '7' && (
                    <div style={{
                        marginTop: '10px',
                        padding: '10px',
                        background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                        borderRadius: '4px'
                    }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>Current Balances:</h4>
                        {isLoadingBalances ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : (
                            <>
                                <div style={{ marginLeft: '10px' }}>
                                    <div>• {(Number(defiBalances.icp) / 1e8).toFixed(4)} ICP</div>
                                    <div>• {(Number(defiBalances.sneed) / 1e8).toFixed(4)} SNEED</div>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {node.id === '9' && (
                    <div style={{
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: theme.colors.tertiaryBg,
                        borderRadius: '4px'
                    }}>
                        <div style={{ marginBottom: '4px' }}>Current Balances:</div>
                        {isLoadingRllData ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {knownTokens.map(([tokenId, tokenInfo]) => {
                                    const reconciliation = reconciliationData.find(item => 
                                        item.token_id.toString() === tokenId.toString()
                                    );
                                    if (!reconciliation) return null;

                                    return (
                                        <div key={tokenId.toString()}>
                                            {(Number(reconciliation.server_balance) / Math.pow(10, tokenInfo.decimals)).toFixed(4)} {tokenInfo.symbol}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
        
        return content;
    };

    const buildEdgeContent = (edge) => {
        const content = (
            <div>
                <div style={{ marginBottom: '8px' }}>{edge.data?.description}</div>
                {edge.data?.token && (
                    <div style={{ color: theme.colors.warning }}>Token: {edge.data.token}</div>
                )}
                {edge.data?.percentage && (
                    <div style={{ color: theme.colors.accent }}>Percentage: {edge.data.percentage}</div>
                )}
            </div>
        );
        
        return content;
    };

    const handleNodeMouseEnter = (event, node) => {
        if (tooltip?.pinned) return;
        setTooltip({ content: buildNodeContent(node), x: event.clientX, y: event.clientY });
    };
    const handleEdgeMouseEnter = (event, edge) => {
        if (tooltip?.pinned) return;
        setTooltip({ content: buildEdgeContent(edge), x: event.clientX, y: event.clientY });
    };
    const handleMouseLeave = () => {
        setTooltip((t) => (t && !t.pinned ? null : t));
    };
    const handleMouseMove = (event) => {
        if (tooltip && !tooltip.pinned) {
            setTooltip((prev) => ({ ...prev, x: event.clientX, y: event.clientY }));
        }
    };
    // A tap or a click pins the card so it can be read and its link followed (hover never fires on a phone)
    const handleNodeClick = (event, node) => {
        setTooltip({ content: buildNodeContent(node), x: event.clientX, y: event.clientY, pinned: true, link: node.data.link, id: node.id });
    };
    const handleEdgeClick = (event, edge) => {
        setTooltip({ content: buildEdgeContent(edge), x: event.clientX, y: event.clientY, pinned: true, id: edge.id });
    };
    const closeTooltip = useCallback(() => setTooltip(null), []);
    // From the hero: jump to the diagram with that stage's card open
    const openStage = (nodeId) => {
        const node = liveNodes.find((n) => n.id === nodeId);
        if (!node) return;
        setActiveTab('rll');
        setTooltip({ content: buildNodeContent(node), x: null, y: null, pinned: true, link: node.data.link, id: node.id });
    };

    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const toggleItem = (id) => {
        setExpandedItems(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    // Add effect to fetch ICP/CLOWN position
    useEffect(() => {
        const fetchOtherLpPositions = async () => {
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });

                // ICP/CLOWN position
                const swapActor = createIcpSwapActor('bdki3-ciaaa-aaaag-qj67a-cai', {
                    agentOptions: { agent }
                });
                
                // Every position the DeFi canister holds in this pool, summed
                const [allPositions, mine] = await Promise.all([
                    swapActor.getUserPositionWithTokenAmount(0, 500),
                    swapActor.getUserPositionsByPrincipal(Principal.fromText('ok64y-uiaaa-aaaag-qdcbq-cai')),
                ]);
                if (allPositions.ok && mine.ok) {
                    const ids = new Set(mine.ok.map(p => Number(p.id)));
                    const held = allPositions.ok.content.filter(p => ids.has(Number(p.id)));
                    const position = held.length === 0 ? null : held.reduce((acc, p) => ({
                        ids: [...acc.ids, Number(p.id)],
                        token0Amount: acc.token0Amount + BigInt(p.token0Amount || 0),
                        token1Amount: acc.token1Amount + BigInt(p.token1Amount || 0),
                        tokensOwed0: acc.tokensOwed0 + BigInt(p.tokensOwed0 || 0),
                        tokensOwed1: acc.tokensOwed1 + BigInt(p.tokensOwed1 || 0),
                    }), { ids: [], token0Amount: 0n, token1Amount: 0n, tokensOwed0: 0n, tokensOwed1: 0n });
                    setOtherLpPositions(prev => ({
                        ...prev,
                        'ICP/CLOWN': {
                            position,
                            loading: false,
                            error: null
                        }
                    }));
                }
            } catch (error) {
                console.error('Error fetching other LP positions:', error);
                setOtherLpPositions(prev => ({
                    ...prev,
                    'ICP/CLOWN': {
                        position: null,
                        loading: false,
                        error: error.message
                    }
                }));
            }
        };

        fetchOtherLpPositions();
    }, []);

    // Calculate total ICP in other pools
    const getOtherPoolsIcpTotal = () => {
        let total = BigInt(0);
        
        // Add ICP/CLOWN position ICP (assuming token1 is ICP)
        if (otherLpPositions['ICP/CLOWN'].position) {
            const pos = otherLpPositions['ICP/CLOWN'].position;
            total += BigInt(pos.token1Amount || 0) + BigInt(pos.tokensOwed1 || 0);
        }
        
        return total;
    };

    // Calculate total USD value for other tokens
    const getOtherTokensUSDTotal = () => {
        let total = 0;
        
        // Add DeFi Canister token balances
        if (Array.isArray(defiKnownTokens)) {
            defiKnownTokens
                .filter(([id]) => id.toString() !== 'ryjl3-tyaaa-aaaaa-aaaba-cai' && id.toString() !== 'hvgxa-wqaaa-aaaaq-aacia-cai')
                .forEach(([tokenId, tokenInfo]) => {
                    const balance = defiTokenBalances[tokenId.toString()];
                    if (balance) {
                        const usdValue = getUSDValue(balance, tokenInfo.decimals, tokenInfo.symbol);
                        if (!isNaN(usdValue)) {
                            total += usdValue;
                        }
                    }
                });
        }

        // Add RLL Distribution balances
        reconciliationData
            .filter(rllBalance => 
                rllBalance.token_id.toString() !== 'ryjl3-tyaaa-aaaaa-aaaba-cai' && 
                rllBalance.token_id.toString() !== 'hvgxa-wqaaa-aaaaq-aacia-cai'
            )
            .forEach(rllBalance => {
                // Find token info in knownTokens array
                const tokenInfo = knownTokens.find(([id]) => id.toString() === rllBalance.token_id.toString())?.[1];
                if (tokenInfo) {
                    const usdValue = getUSDValue(rllBalance.server_balance, tokenInfo.decimals, tokenInfo.symbol);
                    if (!isNaN(usdValue)) {
                        total += usdValue;
                    }
                }
            });
        
        return total;
    };

    // Calculate total USD value for other positions
    const getOtherPositionsUSDTotal = () => {
        let total = 0;
        
        // Add ICP/CLOWN position
        if (otherLpPositions['ICP/CLOWN'].position) {
            const pos = otherLpPositions['ICP/CLOWN'].position;
            // Add ICP value
            total += getUSDValue(pos.token1Amount || 0, 8, 'ICP');
            total += getUSDValue(pos.tokensOwed1 || 0, 8, 'ICP');
            // Add CLOWN value
            total += getUSDValue(pos.token0Amount || 0, 8, 'CLOWN');
            total += getUSDValue(pos.tokensOwed0 || 0, 8, 'CLOWN');
        }
        
        return total;
    };

    // Calculate non-ICP USD value for other positions (for grand total)
    const getOtherPositionsNonIcpUSDTotal = () => {
        let total = 0;
        
        // Add ICP/CLOWN position (only CLOWN part)
        if (otherLpPositions['ICP/CLOWN'].position) {
            const pos = otherLpPositions['ICP/CLOWN'].position;
            // Add only CLOWN value
            total += getUSDValue(pos.token0Amount || 0, 8, 'CLOWN');
            total += getUSDValue(pos.tokensOwed0 || 0, 8, 'CLOWN');
        }
        
        return total;
    };

    // Calculate total ICP USD value including other positions and vectors
    const getTotalIcpUSDValue = () => {
        let total = 
            getUSDValue(treasuryBalances.icp, 8, 'ICP') +
            getUSDValue(neuronBalance?.stake_e8s || 0, 8, 'ICP') +
            getUSDValue(lpPositions.totals.token1Amount, 8, 'ICP') +
            getUSDValue(lpPositions.totals.tokensOwed1, 8, 'ICP') +
            getUSDValue(defiBalances.icp, 8, 'ICP') +
            getUSDValue(rllBalances.icp, 8, 'ICP');  // RLL Distribution ICP

        // Add ICP from Other Positions
        if (otherLpPositions['ICP/CLOWN'].position) {
            total += getUSDValue(otherLpPositions['ICP/CLOWN'].position.token1Amount || 0, 8, 'ICP') +
                     getUSDValue(otherLpPositions['ICP/CLOWN'].position.tokensOwed1 || 0, 8, 'ICP');
        }

        // Add ICP from vectors
        Object.entries(vectorInfo).forEach(([vectorName, vectorData]) => {
            if (vectorData && vectorData.length > 0 && vectorData[0] && vectorData[0][0]) {
                const info = vectorData[0][0];
                // Add balances from sources
                if (info.sources) {
                    info.sources.forEach(source => {
                        if (source.endpoint.ic.ledger.toString() === 'ryjl3-tyaaa-aaaaa-aaaba-cai') { // ICP ledger
                            total += getUSDValue(source.balance, 8, 'ICP');
                        }
                    });
                }
            }
        });

        return total;
    };

    // Calculate total SNEED USD value
    const getTotalSneedUSDValue = () => {
        return getUSDValue(treasuryBalances.sneed, 8, 'SNEED') +
               getUSDValue(lpPositions.totals.token0Amount, 8, 'SNEED') +
               getUSDValue(lpPositions.totals.tokensOwed0, 8, 'SNEED') +
               getUSDValue(defiBalances.sneed, 8, 'SNEED') +
               getUSDValue(rllBalances.sneed, 8, 'SNEED');  // RLL Distribution SNEED
    };

    // Calculate NAV (excluding treasury SNEED)
    const getNAVUSDValue = () => {
        return getTotalIcpUSDValue() +      // All ICP including Other Positions and RLL
               getUSDValue(lpPositions.totals.token0Amount, 8, 'SNEED') +  // LP SNEED
               getUSDValue(lpPositions.totals.tokensOwed0, 8, 'SNEED') +   // Unclaimed LP SNEED
               getUSDValue(defiBalances.sneed, 8, 'SNEED') +               // DeFi SNEED
               getUSDValue(rllBalances.sneed, 8, 'SNEED') +                // RLL Distribution SNEED
               getOtherPositionsNonIcpUSDTotal() +  // Non-ICP values from Other Positions
               getOtherTokensUSDTotal();     // Other tokens
    };

    // Update effect to fetch staking statistics
    useEffect(() => {
        const fetchStakingStats = async () => {
            setIsLoadingStakingStats(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { agent }
                });

                const stats = await rllActor.get_neuron_statistics();
                console.log("STATS", stats);
                setStakingStats(stats);
            } catch (error) {
                console.error('Error fetching staking statistics:', error);
            } finally {
                setIsLoadingStakingStats(false);
            }
        };

        fetchStakingStats();
    }, []);

    // Fetch total supply from SNEED ledger
    useEffect(() => {
        const fetchTotalSupply = async () => {
            try {
                const agent = new HttpAgent({
                    identity,
                    host: "https://ic0.app"
                });

                const sneedLedgerActor = createLedgerActor('hvgxa-wqaaa-aaaaq-aacia-cai', {
                    agentOptions: { agent }
                });
                const supply = await sneedLedgerActor.icrc1_total_supply();
                setTotalSupply(supply);
            } catch (err) {
                console.error('Error fetching total supply:', err);
            }
        };
        fetchTotalSupply();
    }, [identity]);

    // Calculate total supply (in SNEED)
    const getTotalSupply = () => {
        return totalSupply || BigInt(0);
    };

    // Helper function to calculate circulating supply
    const getCirculatingSupply = () => {
        const treasury = BigInt(treasuryBalances.sneed || 0);
        const lpAmount = BigInt(lpPositions.totals?.token0Amount || 0);
        return getTotalSupply() - treasury - lpAmount;
    };

    // Helper function to get total staked SNEED
    const getTotalStakedSneed = () => {
        if (!stakingStats?.total_stake) return BigInt(0);
        return BigInt(stakingStats.total_stake);
    };

    // Helper function to get total SNEED in LPs
    const getTotalSneedInLPs = () => {
        if (!lpPositions?.totals?.token0Amount) return BigInt(0);
        return BigInt(lpPositions.totals.token0Amount);
    };

    // Helper function to calculate TVL
    const getTVL = () => {
        const stakedValue = getUSDValue(getTotalStakedSneed(), 8, 'SNEED') || 0;
        const lpValue = getUSDValue(getTotalSneedInLPs(), 8, 'SNEED') || 0;
        return stakedValue + lpValue;
    };

    return (
        <div className='page-container rll-page' style={{
            background: theme.colors.primaryGradient, minHeight: '100vh',
            '--rll-border': theme.colors.border, '--rll-card-bg': theme.colors.secondaryBg, '--rll-muted': theme.colors.mutedText,
            '--rll-secondary-bg': theme.colors.secondaryBg, '--rll-primary-bg': theme.colors.primaryBg, '--rll-tertiary-bg': theme.colors.tertiaryBg,
            '--rll-text': theme.colors.primaryText, '--rll-secondary-text': theme.colors.secondaryText, '--rll-popover-bg': theme.colors.secondaryBg,
            '--rll-shadow': theme.colors.cardShadow, '--rll-icp-color': theme.colors.accent, '--rll-sneed-color': theme.colors.success, '--rll-burn-color': theme.colors.error,
            '--rll-amber': theme.name === 'bright' ? '#b45309' : rllPrimary,
        }}>
            <Header />
            
            {/* The loop, stage by stage, with the splits the vectors report right now */}
            {(() => {
                const icp = liveSplits['3']?.dests || null;
                const sneed = liveSplits['5']?.dests || null;
                const pctTo = (dests, target) => dests?.find((d) => d.target === target)?.pct;
                const shortName = { '2': 'the neuron', '6': 'treasury', '4': 'buyback', '8': 'burn', '9': 'member rewards', '7': 'DeFi canister' };
                const fanName = { '8': 'Burned', '6': 'Treasury', '9': 'Member rewards' };
                const fanOrder = ['8', '6', '9'];
                const fan = sneed ? [...sneed].filter((d) => d.target).sort((a, b) => (fanOrder.indexOf(a.target) + 1 || 99) - (fanOrder.indexOf(b.target) + 1 || 99)) : null;
                const icpRest = icp ? icp.filter((d) => d.target && d.target !== '4').map((d) => `${d.pct}% to ${shortName[d.target] || d.owner}`).join(', ') : null;
                const buyback = vectorInfo['SNEED Buyback Vector']?.[0]?.[0];
                const buyAmount = buyback?.custom?.[0]?.exchange?.variables?.buy_for_amount;
                const reading = 'reading the vector…';
                const stage = (id, name, fact) => (
                    <button type="button" className="rll-stage" onClick={() => openStage(id)} aria-label={`${name}: open details`}>
                        <span className="rll-stage-name">{name}</span>
                        <span className="rll-stage-fact">{fact}</span>
                    </button>
                );
                return (
                    <div className="rll-hero" style={{ background: theme.colors.primaryBg, '--rll-border': theme.colors.border }}>
                        <div className="rll-hero-inner">
                            <h1 style={{ color: theme.colors.primaryText }}>Recursive Liquidity Loop</h1>
                            <p className="rll-hero-lede" style={{ color: theme.colors.secondaryText }}>
                                Maturity from the DAO's 2-year ICP neuron and revenue from Sneed products buy SNEED on the open market.
                                That SNEED is burned, kept in the treasury, and paid out to voters. The splits below are read live from the vectors that run the loop.
                            </p>
                            <ol className="rll-loop" aria-label="The loop, stage by stage">
                                <li>
                                    {stage('1', '2-year ICP neuron', isLoadingNeuron ? 'reading the neuron…' : neuronBalance ? `${(Number(neuronBalance.stake_e8s) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 0 })} ICP staked` : 'neuron not readable')}
                                    <span className="rll-arrow rll-arrow-icp">maturity</span>
                                </li>
                                <li>
                                    {stage('3', 'ICP splitter', icp ? (icpRest ? `also ${icpRest}` : 'all to buyback') : reading)}
                                    <span className="rll-arrow rll-arrow-icp">{icp ? `${pctTo(icp, '4') ?? 0}%` : '…'}</span>
                                </li>
                                <li>
                                    {stage('4', 'SNEED buyback', buyAmount != null ? `${(Number(buyAmount) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 })} ICP per buy` : reading)}
                                    <span className="rll-arrow rll-arrow-sneed">SNEED</span>
                                </li>
                                <li>
                                    {stage('5', 'SNEED splitter', sneed ? `${sneed.length} destinations` : reading)}
                                    {fan ? (
                                        <ul className="rll-fan" aria-label="Where the SNEED goes">
                                            {fan.map((d) => (
                                                <li key={d.target}>
                                                    <span className={`rll-arrow ${d.target === '8' ? 'rll-arrow-burn' : 'rll-arrow-sneed'}`}>{d.pct}%</span>
                                                    <button type="button" className="rll-stage" onClick={() => openStage(d.target)}>
                                                        <span className="rll-stage-name">{fanName[d.target] || NODE_LABELS[d.target]}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <span className="rll-arrow rll-arrow-sneed">…</span>
                                    )}
                                </li>
                            </ol>
                        </div>
                    </div>
                );
            })()}

            <main className="rllinfo-container">
                <div className="rll-column">
                {/* Prices, in the user's denomination like everything else on the site */}
                <div className="rll-prices" style={{ color: theme.colors.secondaryText }}>
                    <span className="rll-price">SNEED <b className="rll-num" style={{ color: theme.colors.primaryText }}>{conversionRates['ICP'] && conversionRates['SNEED'] ? `${(conversionRates['SNEED'] / conversionRates['ICP']).toLocaleString(undefined, { maximumSignificantDigits: 4 })} ICP` : '…'}</b></span>
                    <span className="rll-price">SNEED <b className="rll-num" style={{ color: theme.colors.primaryText }}>{formatPrice(conversionRates['SNEED'])}</b></span>
                    <span className="rll-price">ICP <b className="rll-num" style={{ color: theme.colors.primaryText }}>{formatPrice(conversionRates['ICP'])}</b></span>
                    <span className="rll-price-source" style={{ color: theme.colors.mutedText }}>Prices from <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a></span>
                </div>

                <div className="rll-tabs" role="tablist" aria-label="Sections">
                    {[['assets', 'Total assets', FaWallet], ['rll', 'Diagram', FaChartLine], ['components', 'Components', FaCubes]].map(([id, label, Icon]) => (
                        <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => { setActiveTab(id); setTooltip(null); }}>
                            <Icon size={14} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>

                <div className="rll-tab-content" style={{ width: '100%' }}>
                    {/* Total Assets Tab */}
                    {activeTab === 'assets' && (
                    <section style={{
                        ...styles.section, 
                        width: '100%',
                        marginTop: 0,
                    }}>
                        <div 
                            style={{
                                ...styles.sectionHeader,
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                gap: '16px',
                            }}
                            onClick={() => setExpandedSections(prev => ({ ...prev, totalAssets: !prev.totalAssets }))}
                        >
                            {/* Header Row */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={styles.sectionIcon}>
                                        <FaWallet size={16} style={{ color: rllPrimary }} />
                                    </div>
                                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', fontWeight: '700' }}>
                                        Total Assets Overview
                                        <InfoTip text={"Comprehensive overview of all DAO assets across different protocols, including treasury holdings, staked positions, LP positions, and tokens pending distribution"} />
                                    </h2>
                                </div>
                                <button type="button" style={styles.expandButton} aria-label={expandedSections.totalAssets ? 'Hide the breakdown' : 'Show the breakdown'} aria-expanded={expandedSections.totalAssets}>
                                    {expandedSections.totalAssets ? '▾' : '▸'}
                                </button>
                            </div>
                            
                            {/* The four headline numbers */}
                            <div className="rll-stat-grid">
                                {[
                                    ['FDV', formatUSD(getUSDValue(getTotalSupply(), 8, 'SNEED')), 'Fully diluted valuation: total SNEED supply at the current price'],
                                    ['Circulating market cap', formatUSD(getUSDValue(getCirculatingSupply(), 8, 'SNEED')), 'SNEED outside the treasury and the DAO\'s own LP positions, at the current price'],
                                    ['NAV', formatUSD(getNAVUSDValue()), 'Net asset value: what the DAO holds, not counting the SNEED in its own treasury'],
                                    ['TVL', formatUSD(getTVL()), 'Value of SNEED staked in neurons plus SNEED in the DAO\'s LP positions'],
                                ].map(([label, value, why]) => (
                                    <div key={label} className="rll-stat" style={{ background: theme.colors.primaryBg }}>
                                        <div className="rll-stat-label" style={{ display: 'flex', alignItems: 'center' }}>{label}<InfoTip text={why} /></div>
                                        <div className="rll-stat-value rll-num" style={{ color: theme.colors.primaryText }}>{value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {expandedSections.totalAssets && <div style={{
                            background: theme.colors.cardGradient, 
                            border: `1px solid ${theme.colors.border}`, 
                            boxShadow: theme.colors.cardShadow,
                            borderRadius: '14px',
                            padding: '1.25rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem',
                        }}>
                            {/* Grand Total in USD */}
                            <div style={{
                                background: `${theme.colors.warning}0a`, 
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.warning}30`,
                            }}>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '10px',
                                    marginBottom: '1rem',
                                }}>
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `${theme.colors.warning}18`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                        <FaDollarSign size={16} style={{ color: theme.colors.warning }} />
                                    </div>
                                    <h3 style={{ color: theme.colors.warning, margin: 0, fontSize: '1rem', fontWeight: '700' }}>
                                        Total Value
                                    </h3>
                                    <InfoTip text={"Total value of all DAO assets. GAV includes SNEED holdings in treasury, while NAV excludes them to avoid circular valuation."} />
                                </div>
                                
                                {/* GAV and NAV Side by Side */}
                                <div style={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                                    gap: '1rem',
                                    marginBottom: '1rem',
                                }}>
                                    {/* GAV Card */}
                                    <div style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '10px',
                                        padding: '1rem',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between',
                                            marginBottom: '8px',
                                        }}>
                                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText, fontWeight: '500' }}>
                                                Gross Asset Value (GAV)
                                            </span>
                                            <InfoTip text={"Gross Asset Value: total market-value of every treasury asset—including self-held tokens—before netting out liabilities. Reveals the full scale of the DAO's resource pool."} />
                                        </div>
                                        <div style={{ fontSize: '1.25rem', fontWeight: '700', color: theme.colors.primaryText }} className="rll-num">
                                            {formatUSD(getTotalIcpUSDValue() + getTotalSneedUSDValue() + getOtherPositionsNonIcpUSDTotal() + getOtherTokensUSDTotal())}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginTop: '6px' }} className="rll-num">
                                            {((getTotalIcpUSDValue() + getTotalSneedUSDValue() + getOtherPositionsNonIcpUSDTotal() + getOtherTokensUSDTotal()) / (conversionRates['ICP'] || 1)).toFixed(2)} ICP
                                        </div>
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between',
                                            marginTop: '10px',
                                            paddingTop: '10px',
                                            borderTop: `1px solid ${theme.colors.border}`,
                                        }}>
                                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>FDV/GAV</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {(getUSDValue(getTotalSupply(), 8, 'SNEED') / ((getTotalIcpUSDValue() + getTotalSneedUSDValue() + getOtherPositionsNonIcpUSDTotal() + getOtherTokensUSDTotal()) || 1)).toFixed(2)}x
                                                </span>
                                                <InfoTip text={"FDV/GAV: fully-diluted valuation divided by gross asset value. > 1 means premium, < 1 means discount to assets."} />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* NAV Card */}
                                    <div style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '10px',
                                        padding: '1rem',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between',
                                            marginBottom: '8px',
                                        }}>
                                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText, fontWeight: '500' }}>
                                                Net Asset Value (NAV)
                                            </span>
                                            <InfoTip text={"Net Asset Value: fair-value of on-chain treasury assets minus liabilities, excluding self-held tokens. Shows the true external backing per token."} />
                                        </div>
                                        <div style={{ fontSize: '1.25rem', fontWeight: '700', color: theme.colors.primaryText }} className="rll-num">
                                            {formatUSD(getNAVUSDValue())}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginTop: '6px' }} className="rll-num">
                                            {(getNAVUSDValue() / (conversionRates['ICP'] || 1)).toFixed(2)} ICP
                                        </div>
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between',
                                            marginTop: '10px',
                                            paddingTop: '10px',
                                            borderTop: `1px solid ${theme.colors.border}`,
                                        }}>
                                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>P/NAV</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {(getUSDValue(getCirculatingSupply(), 8, 'SNEED') / (getNAVUSDValue() || 1)).toFixed(2)}x
                                                </span>
                                                <InfoTip text={"Price-to-NAV: circulating market cap divided by DAO NAV. < 1 suggests undervalued, > 1 shows premium."} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* NGAR Pill */}
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center',
                                    gap: '10px',
                                    padding: '10px 16px',
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '10px',
                                    border: `1px solid ${theme.colors.border}`,
                                }}>
                                    <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                        Net-to-Gross Alignment Ratio (NGAR)
                                    </span>
                                    <span style={{ fontSize: '1rem', fontWeight: '700', color: theme.colors.warning }}>
                                        {((getUSDValue(getCirculatingSupply(), 8, 'SNEED') / (getNAVUSDValue() || 1)) / 
                                          (getUSDValue(getTotalSupply(), 8, 'SNEED') / ((getTotalIcpUSDValue() + getTotalSneedUSDValue() + getOtherPositionsNonIcpUSDTotal() + getOtherTokensUSDTotal()) || 1))).toFixed(2)}x
                                    </span>
                                    <InfoTip text={"NGAR: (P/NAV) ÷ (FDV/GAV). Measures valuation alignment. Near 1 = aligned, < 1 = untapped upside, > 1 = dilution warning."} />
                                </div>
                            </div>

                            {/* Market Cap Card */}
                            <div style={{
                                background: `${theme.colors.success}0a`,
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.success}30`,
                            }}>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '10px',
                                    marginBottom: '1rem',
                                }}>
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `${theme.colors.success}18`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                        <FaChartLine size={16} style={{ color: theme.colors.success }} />
                                    </div>
                                    <h3 style={{ color: theme.colors.success, margin: 0, fontSize: '1rem', fontWeight: '700' }}>
                                        Market Cap & Supply
                                    </h3>
                                    <InfoTip text={"Overview of SNEED token supply, market metrics, and total value locked (TVL)"} />
                                </div>
                                {isLoadingBalances || isLoadingStakingStats || isLoadingLp ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                        <div style={styles.spinner} />
                                    </div>
                                ) : (
                                    <>
                                        {/* Key Metrics Grid */}
                                        <div style={{ 
                                            display: 'grid', 
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
                                            gap: '10px',
                                            marginBottom: '1rem',
                                        }}>
                                            {/* FDV */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                                textAlign: 'center',
                                            }}>
                                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginBottom: '4px', fontWeight: '500' }}>FDV</div>
                                                <div style={{ fontSize: '1rem', fontWeight: '700', color: theme.colors.success }} className="rll-num">
                                                    {formatUSD(getUSDValue(getTotalSupply(), 8, 'SNEED'))}
                                                </div>
                                            </div>
                                            {/* Circ. Market Cap */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                                textAlign: 'center',
                                            }}>
                                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginBottom: '4px', fontWeight: '500' }}>Circ. Market Cap</div>
                                                <div style={{ fontSize: '1rem', fontWeight: '700', color: theme.colors.success }} className="rll-num">
                                                    {formatUSD(getUSDValue(getCirculatingSupply(), 8, 'SNEED'))}
                                                </div>
                                            </div>
                                            {/* TVL */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                                textAlign: 'center',
                                            }}>
                                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginBottom: '4px', fontWeight: '500' }}>TVL</div>
                                                <div style={{ fontSize: '1rem', fontWeight: '700', color: theme.colors.success }} className="rll-num">
                                                    {formatUSD(getTVL())}
                                                </div>
                                            </div>
                                            {/* TVL/MCap */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                                textAlign: 'center',
                                            }}>
                                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginBottom: '4px', fontWeight: '500' }}>TVL/MCap</div>
                                                <div style={{ fontSize: '1rem', fontWeight: '700', color: theme.colors.success }} className="rll-num">
                                                    {(getTVL() / (getUSDValue(getCirculatingSupply(), 8, 'SNEED') || 1)).toFixed(2)}x
                                                </div>
                                            </div>
                                        </div>

                                        {/* Supply Details */}
                                        <div style={{ 
                                            display: 'grid', 
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
                                            gap: '10px',
                                        }}>
                                            {/* Total Supply */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                            }}>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '6px' }}>Total Supply</div>
                                                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {(Number(getTotalSupply()) / 1e8).toLocaleString()} SNEED
                                                </div>
                                            </div>
                                            {/* Circulating Supply */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                            }}>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '6px' }}>Circulating Supply</div>
                                                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {(Number(getCirculatingSupply()) / 1e8).toLocaleString()} SNEED
                                                </div>
                                            </div>
                                            {/* Total Staked */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                            }}>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '6px' }}>Total Staked</div>
                                                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {(Number(getTotalStakedSneed()) / 1e8).toLocaleString()} SNEED
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                    {formatUSD(getUSDValue(getTotalStakedSneed(), 8, 'SNEED'))}
                                                </div>
                                            </div>
                                            {/* Total in LPs */}
                                            <div style={{
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '10px',
                                                padding: '0.875rem',
                                                border: `1px solid ${theme.colors.border}`,
                                            }}>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '6px' }}>Total in LPs</div>
                                                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {(Number(getTotalSneedInLPs()) / 1e8).toLocaleString()} SNEED
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                    {formatUSD(getUSDValue(getTotalSneedInLPs(), 8, 'SNEED'))}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* ICP Assets */}
                            <div style={{
                                background: `${theme.colors.accent}0a`,
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.accent}30`,
                            }}>
                                <div 
                                    onClick={() => toggleSection('icpAssets')}
                                    style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        cursor: 'pointer',
                                        marginBottom: expandedSections.icpAssets ? '1rem' : 0,
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '10px',
                                            background: `${theme.colors.accent}18`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}>
                                            <FaCoins size={16} style={{ color: theme.colors.accent }} />
                                        </div>
                                        <h3 style={{ color: theme.colors.accent, margin: 0, fontSize: '1rem', fontWeight: '700' }}>
                                            ICP Assets
                                        </h3>
                                        <InfoTip text={"Overview of ICP holdings across treasury wallets and investment positions"} />
                                    </div>
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '8px',
                                        background: theme.colors.secondaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        transform: `rotate(${expandedSections.icpAssets ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                    }}>▸</span>
                                </div>
                                
                                {/* Details section - collapsible */}
                                {expandedSections.icpAssets && (
                                    <>
                                        {isLoadingBalances || isLoadingNeuron || isLoadingLp ? (
                                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                                <div style={styles.spinner} />
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/account/580deb37eb3583e5854516481bd52c2618ca73ef6ee1c2df2b556bf85c0ce5a9"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            Treasury:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(treasuryBalances.icp) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(treasuryBalances.icp, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/neuron/4000934039483276792"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            ICP Neuron:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(neuronBalance?.stake_e8s || 0) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(neuronBalance?.stake_e8s || 0, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://app.icpswap.com/info-swap/pool/details/osyzs-xiaaa-aaaag-qc76q-cai"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            ICP/SNEED LP:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.token1Amount) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(lpPositions.totals.token1Amount, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>Unclaimed LP Rewards:</div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.tokensOwed1) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(lpPositions.totals.tokensOwed1, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/canister/ok64y-uiaaa-aaaag-qdcbq-cai"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            DeFi Canister:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(defiBalances.icp) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(defiBalances.icp, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://app.sneeddao.com/rll"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            RLL Distribution:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(rllBalances.icp) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(rllBalances.icp, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                {vectorInfo['SNEED Buyback Vector']?.[0]?.[0]?.sources?.[0]?.balance && (
                                                    <div style={{ marginBottom: '15px' }}>
                                                        <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                            <a 
                                                                href="https://beta.icpcoins.com/#/vector/modify/togwv-zqaaa-aaaal-qr7aa-cai/exchange/18"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                            >
                                                                Buyback Vector:
                                                            </a>
                                                        </div>
                                                        <div style={{ fontSize: '1.1em' }}>
                                                            {(Number(vectorInfo['SNEED Buyback Vector'][0][0].sources[0].balance) / 1e8).toFixed(4)} ICP
                                                            <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                                ({formatUSD(getUSDValue(vectorInfo['SNEED Buyback Vector'][0][0].sources[0].balance, 8, 'ICP'))})
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>Other Pools:</div>
                                                    {otherLpPositions['ICP/CLOWN'].loading ? (
                                                        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                                            <div style={styles.spinner} />
                                                        </div>
                                                    ) : otherLpPositions['ICP/CLOWN'].error ? (
                                                        <div style={{ color: theme.colors.error }}>Error loading ICP/CLOWN position</div>
                                                    ) : otherLpPositions['ICP/CLOWN'].position ? (
                                                        <div style={{ marginLeft: '15px' }}>
                                                            <div style={{ marginBottom: '8px' }}>
                                                                <a 
                                                                    href="https://app.icpswap.com/info-swap/pool/details/bdki3-ciaaa-aaaag-qj67a-cai"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                                >
                                                                    ICP/CLOWN LP{otherLpPositions['ICP/CLOWN'].position?.ids?.length ? ` (positions ${otherLpPositions['ICP/CLOWN'].position.ids.join(', ')})` : ''}:
                                                                </a>
                                                            </div>
                                                            <div style={{ fontSize: '1em', marginLeft: '10px' }}>
                                                                • Position: {(Number(otherLpPositions['ICP/CLOWN'].position.token1Amount) / 1e8).toFixed(4)} ICP
                                                                <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                                    ({formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.token1Amount, 8, 'ICP'))})
                                                                </span>
                                                            </div>
                                                            {Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed1) > 0 && (
                                                                <div style={{ fontSize: '1em', marginLeft: '10px' }}>
                                                                    • Unclaimed: {(Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed1) / 1e8).toFixed(4)} ICP
                                                                    <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                                        ({formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.tokensOwed1, 8, 'ICP'))})
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div style={{ color: theme.colors.mutedText, marginLeft: '15px' }}>No positions found</div>
                                                    )}
                                                    <div style={{ fontSize: '1.1em', marginTop: '10px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '10px' }}>
                                                        Total: {(Number(getOtherPoolsIcpTotal()) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(getOtherPoolsIcpTotal(), 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}

                                {/* Footer with total - always visible */}
                                <div style={{
                                    marginTop: '15px',
                                    paddingTop: '15px',
                                    borderTop: `1px solid ${theme.colors.accent}`
                                }}>
                                    <div style={{ color: theme.colors.accent, marginBottom: '5px' }}>Total ICP:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        {((Number(treasuryBalances.icp) + 
                                           Number(neuronBalance?.stake_e8s || 0) + 
                                           Number(lpPositions.totals.token1Amount) +
                                           Number(lpPositions.totals.tokensOwed1) +
                                           Number(defiBalances.icp) +
                                           Number(rllBalances.icp) +
                                           Number(vectorInfo['SNEED Buyback Vector']?.[0]?.[0]?.sources?.[0]?.balance || 0) +
                                           Number(getOtherPoolsIcpTotal())) / 1e8).toFixed(4)} ICP
                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px', fontSize: '0.8em' }}>
                                            ({formatUSD(
                                                getUSDValue(treasuryBalances.icp, 8, 'ICP') +
                                                getUSDValue(neuronBalance?.stake_e8s || 0, 8, 'ICP') +
                                                getUSDValue(lpPositions.totals.token1Amount, 8, 'ICP') +
                                                getUSDValue(lpPositions.totals.tokensOwed1, 8, 'ICP') +
                                                getUSDValue(defiBalances.icp, 8, 'ICP') +
                                                getUSDValue(rllBalances.icp, 8, 'ICP') +
                                                getUSDValue(vectorInfo['SNEED Buyback Vector']?.[0]?.[0]?.sources?.[0]?.balance || 0, 8, 'ICP') +
                                                getUSDValue(getOtherPoolsIcpTotal(), 8, 'ICP')
                                            )})
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* SNEED Assets */}
                            <div style={{
                                background: `${theme.colors.success}0a`,
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.success}30`,
                            }}>
                                <div 
                                    onClick={() => toggleSection('sneedAssets')}
                                    style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        cursor: 'pointer',
                                        marginBottom: expandedSections.sneedAssets ? '1rem' : 0,
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '10px',
                                            background: `${theme.colors.success}18`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}>
                                            <FaLeaf size={16} style={{ color: theme.colors.success }} />
                                        </div>
                                        <h3 style={{ color: theme.colors.success, margin: 0, fontSize: '1rem', fontWeight: '700' }}>
                                            SNEED Assets
                                        </h3>
                                        <InfoTip text={"Overview of SNEED token holdings across treasury wallets and investment positions"} />
                                    </div>
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '8px',
                                        background: theme.colors.secondaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        transform: `rotate(${expandedSections.sneedAssets ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                    }}>▸</span>
                                </div>

                                {/* Details section - collapsible */}
                                {expandedSections.sneedAssets && (
                                    <>
                                        {isLoadingBalances || isLoadingLp ? (
                                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                                <div style={styles.spinner} />
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/sns/fp274-iaaaa-aaaaq-aacha-cai/account/fi3zi-fyaaa-aaaaq-aachq-cai-laerbmy.8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            Treasury:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(treasuryBalances.sneed) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(treasuryBalances.sneed, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://app.icpswap.com/info-swap/pool/details/osyzs-xiaaa-aaaag-qc76q-cai"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            ICP/SNEED LP:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.token0Amount) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(lpPositions.totals.token0Amount, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>Unclaimed LP Rewards:</div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.tokensOwed0) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(lpPositions.totals.tokensOwed0, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/canister/ok64y-uiaaa-aaaag-qdcbq-cai"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            DeFi Canister:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(defiBalances.sneed) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(defiBalances.sneed, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: theme.colors.mutedText, marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://app.sneeddao.com/rll"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: theme.colors.accent, textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            RLL Distribution:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(rllBalances.sneed) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(rllBalances.sneed, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}

                                {/* Footer with total - always visible */}
                                <div style={{
                                    marginTop: '15px',
                                    paddingTop: '15px',
                                    borderTop: `1px solid ${theme.colors.success}`
                                }}>
                                    <div style={{ color: theme.colors.success, marginBottom: '5px' }}>Total SNEED:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        {((Number(treasuryBalances.sneed) + 
                                           Number(lpPositions.totals.token0Amount) +
                                           Number(lpPositions.totals.tokensOwed0) +
                                           Number(defiBalances.sneed) +
                                           Number(rllBalances.sneed)) / 1e8).toFixed(4)} SNEED
                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px', fontSize: '0.8em' }}>
                                            ({formatUSD(
                                                getUSDValue(treasuryBalances.sneed, 8, 'SNEED') +
                                                getUSDValue(lpPositions.totals.token0Amount, 8, 'SNEED') +
                                                getUSDValue(lpPositions.totals.tokensOwed0, 8, 'SNEED') +
                                                getUSDValue(defiBalances.sneed, 8, 'SNEED') +
                                                getUSDValue(rllBalances.sneed, 8, 'SNEED')
                                            )})
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Other Tokens */}
                            <div style={{
                                background: theme.colors.secondaryBg,
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.border}`,
                            }}>
                                <div 
                                    onClick={() => toggleSection('otherTokens')}
                                    style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        cursor: 'pointer',
                                        marginBottom: expandedSections.otherTokens ? '1rem' : 0,
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '10px',
                                            background: `${theme.colors.mutedText}18`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}>
                                            <FaLayerGroup size={16} style={{ color: theme.colors.secondaryText }} />
                                        </div>
                                        <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1rem', fontWeight: '700' }}>
                                            Other Tokens
                                        </h3>
                                        <InfoTip text={"Overview of other token holdings in the treasury"} />
                                    </div>
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '8px',
                                        background: theme.colors.secondaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        transform: `rotate(${expandedSections.otherTokens ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                    }}>▸</span>
                                </div>
                                {expandedSections.otherTokens && (
                                    <>
                                        {isLoadingRllData ? (
                                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                                <div style={styles.spinner} />
                                            </div>
                                        ) : (
                                            <>
                                                {/* DeFi Canister Balances */}
                                                <div style={{ marginBottom: '25px' }}>
                                                    <div style={{ 
                                                        color: theme.colors.accent, 
                                                        fontSize: '1.1em', 
                                                        fontWeight: 'bold',
                                                        marginBottom: '15px',
                                                        borderBottom: `1px solid ${theme.colors.border}`,
                                                        paddingBottom: '5px'
                                                    }}>
                                                        DeFi Canister Balances
                                                    </div>
                                                    <div style={{ marginLeft: '15px' }}>
                                                        {defiKnownTokens
                                                            .filter(([tokenId]) => {
                                                                const id = tokenId.toString();
                                                                return id !== 'ryjl3-tyaaa-aaaaa-aaaba-cai' && 
                                                                       id !== 'hvgxa-wqaaa-aaaaq-aacia-cai';
                                                            })
                                                            .map(([tokenId, tokenInfo]) => {
                                                                const balance = defiTokenBalances[tokenId.toString()];
                                                                if (!balance) return null;
                                                                
                                                                const usdValue = getUSDValue(balance, tokenInfo.decimals, tokenInfo.symbol);
                                                                
                                                                return (
                                                                    <div key={tokenId.toString()} style={{ marginBottom: '10px', marginLeft: '10px' }}>
                                                                        {(Number(balance) / Math.pow(10, tokenInfo.decimals)).toFixed(4)} {tokenInfo.symbol}
                                                                        {!isNaN(usdValue) && usdValue > 0 && (
                                                                            <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                                                ({formatUSD(usdValue)})
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })
                                                            .filter(item => item !== null)
                                                        }
                                                    </div>
                                                </div>

                                                {/* RLL Distribution Balances */}
                                                <div>
                                                    <div style={{ 
                                                        color: theme.colors.accent, 
                                                        fontSize: '1.1em', 
                                                        fontWeight: 'bold',
                                                        marginBottom: '15px',
                                                        borderBottom: `1px solid ${theme.colors.border}`,
                                                        paddingBottom: '5px'
                                                    }}>
                                                        RLL Distribution Balances
                                                    </div>
                                                    <div style={{ marginLeft: '15px' }}>
                                                        {knownTokens
                                                            .filter(([tokenId]) => {
                                                                const id = tokenId.toString();
                                                                return id !== 'ryjl3-tyaaa-aaaaa-aaaba-cai' && id !== 'hvgxa-wqaaa-aaaaq-aacia-cai';
                                                            })
                                                            .map(([tokenId, tokenInfo]) => {
                                                                const rllBalance = reconciliationData.find(item => 
                                                                    item.token_id.toString() === tokenId.toString()
                                                                );
                                                                if (!rllBalance) return null;

                                                                return (
                                                                    <div key={tokenId.toString()} style={{ marginBottom: '10px' }}>
                                                                        <div style={{ marginLeft: '10px' }}>
                                                                            {(Number(rllBalance.server_balance) / Math.pow(10, tokenInfo.decimals)).toFixed(4)} {tokenInfo.symbol}
                                                                            <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                                                ({formatUSD(getUSDValue(rllBalance.server_balance, tokenInfo.decimals, tokenInfo.symbol))})
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })
                                                            .filter(item => item !== null)
                                                        }
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}

                                {/* Footer with total - always visible */}
                                <div style={{
                                    marginTop: '15px',
                                    paddingTop: '15px',
                                    borderTop: `1px solid ${theme.colors.accent}`
                                }}>
                                    <div style={{ color: theme.colors.accent, marginBottom: '5px' }}>Total Value:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        {formatUSD(getOtherTokensUSDTotal())}
                                    </div>
                                </div>
                            </div>

                            {/* Other Positions */}
                            <div style={{
                                background: theme.colors.secondaryBg,
                                padding: '1.25rem',
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.border}`,
                            }}>
                                <div 
                                    onClick={() => toggleSection('otherPositions')}
                                    style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        cursor: 'pointer',
                                        marginBottom: expandedSections.otherPositions ? '1rem' : 0,
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '10px',
                                            background: `${theme.colors.mutedText}18`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}>
                                            <FaCubes size={16} style={{ color: theme.colors.secondaryText }} />
                                        </div>
                                        <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1rem', fontWeight: '700' }}>
                                            Other Positions
                                        </h3>
                                        <InfoTip text={"Overview of other investment positions and holdings"} />
                                    </div>
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '8px',
                                        background: theme.colors.secondaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        transform: `rotate(${expandedSections.otherPositions ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                    }}>▸</span>
                                </div>

                                {expandedSections.otherPositions && (
                                    <>
                                        {otherLpPositions['ICP/CLOWN'].loading ? (
                                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                                <div style={styles.spinner} />
                                            </div>
                                        ) : otherLpPositions['ICP/CLOWN'].error ? (
                                            <div style={{ color: theme.colors.error }}>Error loading ICP/CLOWN position: {otherLpPositions['ICP/CLOWN'].error}</div>
                                        ) : otherLpPositions['ICP/CLOWN'].position && (
                                            <div style={{
                                                marginBottom: '15px',
                                                padding: '10px',
                                                background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
                                                borderRadius: '4px'
                                            }}>
                                                <div style={{ color: theme.colors.accent, marginBottom: '8px', fontWeight: 'bold' }}>
                                                    ICP/CLOWN Position #168
                                                </div>
                                                <div style={{ marginLeft: '10px' }}>
                                                    <div>Current Position:</div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.token1Amount) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.token1Amount, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.token0Amount) / 1e8).toFixed(4)} CLOWN
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.token0Amount, 8, 'CLOWN'))})
                                                        </span>
                                                    </div>
                                                    <div style={{ marginTop: '5px' }}>Unclaimed Rewards:</div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed1) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.tokensOwed1, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed0) / 1e8).toFixed(4)} CLOWN
                                                        <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                            ({formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.tokensOwed0, 8, 'CLOWN'))})
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Footer with total - always visible */}
                                <div style={{
                                    marginTop: '15px',
                                    paddingTop: '15px',
                                    borderTop: `1px solid ${theme.colors.accent}`
                                }}>
                                    <div style={{ color: theme.colors.accent, marginBottom: '5px' }}>Total Value:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        {formatUSD(getOtherPositionsUSDTotal())}
                                    </div>
                                </div>
                            </div>
                        </div>}
                    </section>
                    )}

                    {/* Diagram tab */}
                    {activeTab === 'rll' && (
                    <section className="rll-diagram-section" style={{
                        ...styles.section,
                        width: '100%',
                        marginTop: 0,
                    }}>
                        <div style={{ ...styles.sectionHeader, marginBottom: '12px', cursor: 'default' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div style={styles.sectionIcon}>
                                    <FaChartLine size={16} style={{ color: rllPrimary }} />
                                </div>
                                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', fontSize: '1.1rem', fontWeight: '700' }}>
                                    The loop as a diagram
                                    <InfoTip text={"Every box is a canister or an account; every arrow is a flow of tokens. Hover or tap a box or an arrow for what it holds and where it sends things. The split percentages are read from the vectors, not typed in."} />
                                </h2>
                            </div>
                        </div>
                        <div className="rll-legend">
                            <span><i style={{ background: theme.colors.accent }} />ICP</span>
                            <span><i style={{ background: theme.colors.success }} />SNEED</span>
                            <span><i style={{ background: rllPrimary }} />mixed revenue</span>
                            <span className="rll-hint">{isLoadingVectors ? 'Reading the vectors…' : 'Tap a box for details. Pinch or use the buttons to zoom.'}</span>
                        </div>
                        <div className="rll-diagram-box">
                            <ReactFlow
                                nodes={liveNodes}
                                edges={liveEdges}
                                fitView
                                fitViewOptions={{ padding: 0.15 }}
                                minZoom={0.2}
                                zoomOnScroll={false}
                                preventScrolling={false}
                                nodesConnectable={false}
                                onNodeMouseEnter={handleNodeMouseEnter}
                                onNodeMouseLeave={handleMouseLeave}
                                onEdgeMouseEnter={handleEdgeMouseEnter}
                                onEdgeMouseLeave={handleMouseLeave}
                                onMouseMove={handleMouseMove}
                                onNodeClick={handleNodeClick}
                                onEdgeClick={handleEdgeClick}
                                onPaneClick={closeTooltip}
                                style={{ width: '100%', height: '100%' }}
                            >
                                <Background color={theme.colors.border} gap={16} />
                                <Controls showInteractive={false} />
                                <TokenAnimationManager edges={liveEdges} nodes={liveNodes} />
                            </ReactFlow>
                        </div>
                        <TooltipOverlay tooltip={tooltip} onClose={closeTooltip} />
                    </section>
                    )}

                    {/* System Components Tab */}
                    {activeTab === 'components' && (
                    <section style={{
                        ...styles.section, 
                        width: '100%',
                        marginTop: 0,
                    }}>
                        <div style={{ ...styles.sectionHeader, marginBottom: '12px', cursor: 'default' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div style={styles.sectionIcon}>
                                    <FaCubes size={16} style={{ color: rllPrimary }} />
                                </div>
                                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', fontSize: '1.1rem', fontWeight: '700' }}>
                                    Components
                                    <InfoTip text={"Every canister and account that takes part in the loop, with what goes in, what comes out, and the ids to check on chain. Splits are read from the vectors."} />
                                </h2>
                            </div>
                        </div>
                        {Object.entries(liveSections).map(([key, section]) => (
                            <div key={key}>
                                <div 
                                    style={styles.expandableHeader}
                                    onClick={() => toggleSection(key)}
                                >
                                    <div style={styles.headerLeft}>
                                        <span>{section.title}</span>
                                    </div>
                                    <div style={styles.headerRight}>
                                        <InfoTip text={section.description || `Details about ${section.title} components and their functions in the system`} />
                                        <span style={{
                                            display: 'inline-block',
                                            transform: `rotate(${expandedSections[key] ? '90deg' : '0deg'})`,
                                            transition: 'transform 0.2s ease'
                                        }}>▸</span>
                                    </div>
                                </div>
                                {expandedSections[key] && (
                                    <div style={styles.content}>
                                        {section.items.map(item => (
                                            <div key={item.id} style={styles.item}>
                                                <div 
                                                    style={styles.itemHeader}
                                                    onClick={() => toggleItem(item.id)}
                                                >
                                                    <div style={styles.headerLeft}>
                                                        <span>{item.title}</span>
                                                    </div>
                                                    <div style={styles.headerRight}>
                                                        {item.link && (
                                                            <a 
                                                                href={item.link}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={e => e.stopPropagation()}
                                                                style={styles.globeIcon}
                                                            >
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <circle cx="12" cy="12" r="10"></circle>
                                                                    <line x1="2" y1="12" x2="22" y2="12"></line>
                                                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                                                </svg>
                                                            </a>
                                                        )}
                                                        <InfoTip text={item.description} />
                                                        <span style={{
                                                            display: 'inline-block',
                                                            transform: `rotate(${expandedItems[item.id] ? '90deg' : '0deg'})`,
                                                            transition: 'transform 0.2s ease'
                                                        }}>▸</span>
                                                    </div>
                                                </div>
                                                {expandedItems[item.id] && renderItemDetails(item)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        <h2 style={{ marginTop: '32px', fontSize: '1.05rem', ...styles.heading }}>
                            <div style={styles.headingLeft}>
                                <span>Token flows</span>
                                <InfoTip text={"Each arrow of the diagram as a line: which token, from where, to where, and what share. Shares from the two splitters are read live from the vectors."} />
                            </div>
                        </h2>
                        {Object.entries(liveFlowSections).map(([key, section]) => (
                            <div key={key}>
                                <div 
                                    style={styles.expandableHeader}
                                    onClick={() => toggleSection(key + '_edges')}
                                >
                                    <div style={styles.headerLeft}>
                                        <span>{section.title}</span>
                                    </div>
                                    <div style={styles.headerRight}>
                                        <InfoTip text={`${section.title}: ${section.items.length} flows`} />
                                        <span style={{
                                            display: 'inline-block',
                                            transform: `rotate(${expandedSections[key + '_edges'] ? '90deg' : '0deg'})`,
                                            transition: 'transform 0.2s ease'
                                        }}>▸</span>
                                    </div>
                                </div>
                                {expandedSections[key + '_edges'] && (
                                    <div style={styles.content}>
                                        {section.items.map(item => (
                                            <div key={item.id} style={styles.item}>
                                                <div 
                                                    style={styles.itemHeader}
                                                    onClick={() => toggleItem(item.id)}
                                                >
                                                    <div style={styles.headerLeft}>
                                                        <span>{item.description}</span>
                                                        {item.live && <span style={{ marginLeft: 8, fontSize: '0.72rem', fontWeight: 500, color: theme.colors.mutedText }}>live</span>}
                                                    </div>
                                                    <div style={styles.headerRight}>
                                                        <InfoTip text={`${item.percentage} of the ${item.token} leaving ${nodeTitle(item.source)} goes to ${nodeTitle(item.target)}`} />
                                                        <span style={{
                                                            display: 'inline-block',
                                                            transform: `rotate(${expandedItems[item.id] ? '90deg' : '0deg'})`,
                                                            transition: 'transform 0.2s ease'
                                                        }}>▸</span>
                                                    </div>
                                                </div>
                                                {expandedItems[item.id] && (
                                                    <div style={styles.itemContent}>
                                                        <p style={{ margin: '4px 0' }}>Token: {item.token}</p>
                                                        <p style={{ margin: '4px 0' }}>From: {nodeTitle(item.source)}</p>
                                                        <p style={{ margin: '4px 0' }}>To: {nodeTitle(item.target)}</p>
                                                        <p style={{ margin: '4px 0' }}>Share: {item.percentage}{item.live ? ' (read from the vector)' : ''}</p>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </section>
                    )}
                </div>

                </div>
            </main>
        </div>
    );
}

export default RLLInfo;
