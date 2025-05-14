import React, { useState, useCallback, useEffect } from 'react';
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
import { useCallback as useTooltipCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { Actor, HttpAgent } from '@dfinity/agent';
import { createActor as createNnsGovActor } from 'external/nns_gov';
import { createActor as createVectorActor } from 'external/icrc55_vector';
import { createActor as createExVectorActor } from 'external/icrc55_exvector';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { get_token_conversion_rates } from './utils/TokenUtils';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createNeutriniteDappActor } from 'external/neutrinite_dapp';

// Styles for the expandable sections
const styles = {
    section: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        color: '#ffffff'
    },
    expandableHeader: {
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px',
        backgroundColor: '#3a3a3a',
        borderRadius: '4px',
        marginBottom: '10px'
    },
    content: {
        padding: '10px'
    },
    item: {
        backgroundColor: '#3a3a3a',
        borderRadius: '4px',
        padding: '15px',
        marginBottom: '10px'
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
        marginLeft: '20px'
    },
    list: {
        listStyle: 'none',
        padding: 0,
        margin: '10px 0'
    },
    flowContainer: {
        position: 'relative',  // Establish positioning context
        width: '100%',
        height: '600px',
        backgroundColor: '#1a1a1a',
        borderRadius: '8px'
        // Remove the conflicting flex: '1 1 auto' from here
    },
    link: {
        color: '#3498db',
        textDecoration: 'none',
        '&:hover': {
            textDecoration: 'underline'
        }
    },
    detailsSection: {
        marginTop: '10px',
        padding: '10px',
        backgroundColor: '#2a2a2a',
        borderRadius: '4px'
    },
    canisterId: {
        fontFamily: 'monospace',
        backgroundColor: '#1a1a1a',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '0.9em'
    },
    spinner: {
        border: '4px solid rgba(255, 255, 255, 0.3)',
        borderTop: '4px solid #3498db',
        borderRadius: '50%',
        width: '20px',
        height: '20px',
        animation: 'spin 1s linear infinite'
    },
    statusItem: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '5px'
    },
    infoIcon: {
        color: '#3498db',
        cursor: 'help',
        fontSize: '16px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: '1px solid #3498db',
        marginLeft: '4px'
    },
    heading: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    }
};

// Node styles
const nodeStyles = {
    infrastructure: {
        background: '#2d3436',
        color: '#fff',
        border: '1px solid #0984e3',
        borderRadius: '8px',
        padding: '10px',
        width: 180,
    },
    tokenManagement: {
        background: '#2d3436',
        color: '#fff',
        border: '1px solid #00b894',
        borderRadius: '8px',
        padding: '10px',
        width: 180,
    },
    revenue: {
        background: '#2d3436',
        color: '#fff',
        border: '1px solid #fdcb6e',
        borderRadius: '8px',
        padding: '10px',
        width: 180,
    }
};

// Edge styles
const edgeStyles = {
    icp: {
        stroke: '#0984e3',
        strokeWidth: 2,
        animated: true,
    },
    sneed: {
        stroke: '#00b894',
        strokeWidth: 2,
        animated: true,
    },
    various: {
        stroke: '#fdcb6e',
        strokeWidth: 2,
        animated: true,
    },
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
        return ['1', '11', '13', '14'].includes(nodeId); // 8y neuron, LP Rewards, SneedLock, Swaprunner
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
            // 8y neuron always generates ICP
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
                            // If from 8y neuron (maturity), send to ICP Splitter
                            edges.find(e => e.id === 'e2') :
                            // If from ICP Splitter (compounding), send to 8y neuron
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
                // For 8y neuron, spawn tokens to ICP Neuron Vector
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

// Update the TooltipOverlay to accept tooltip as a prop
const TooltipOverlay = ({ tooltip }) => {
    // Only render if tooltip exists and has content
    return (tooltip && tooltip.content) ? (
        <div
            style={{
                position: 'fixed',
                left: `${tooltip.x + 10}px`,
                top: `${tooltip.y + 10}px`,
                zIndex: 1000,
                maxWidth: '300px',
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                color: 'white',
                padding: '12px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                lineHeight: '1.4',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                pointerEvents: 'none',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'normal'
            }}
        >
            {tooltip.content}
        </div>
    ) : null;
};

// Node definitions with their metadata
const nodes = {
    infrastructure: {
        title: "Core Infrastructure",
        items: [
            {
                id: "1",
                title: "8 Year ICP NNS Neuron",
                description: "Long-term ICP staking neuron with 8-year dissolve delay",
                inputs: ["ICP from Neuron Vector"],
                outputs: ["Maturity to Neuron Vector"],
                details: "Controlled by ICP Neuron Vector for maturity collection and compounding",
                link: "https://dashboard.internetcomputer.org/neuron/4000934039483276792"
            },
            {
                id: "2",
                title: "ICP Neuron Vector",
                description: "Controls NNS Neuron and manages maturity collection",
                inputs: ["ICP from Splitter (25%)", "Maturity from NNS Neuron"],
                outputs: ["ICP to NNS Neuron"],
                canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-wu6phoy.100000000010000000000000000000000000000000000000000000000000000",
                details: "Vector ID: 1 on Neuronpool",
                link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/1"
            },
            {
                id: "3",
                title: "ICP Splitter Vector",
                description: "Distributes ICP to multiple destinations with fixed proportions",
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
        items: [
            {
                id: "4",
                title: "SNEED Buyback Vector",
                description: "Purchases SNEED from market using ICP",
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
                description: "Distributes SNEED to multiple destinations with fixed proportions",
                inputs: ["SNEED from Buyback"],
                outputs: [
                    "33% SNEED to Treasury",
                    "34% SNEED to DeFi Canister",
                    "33% SNEED to Burn Address"
                ],
                canisterId: "6jvpj-sqaaa-aaaaj-azwnq-cai-vilbrxq.1000000002d0000000000000000000000000000000000000000000000000000",
                details: "Vector ID: 45 on Neuronpool",
                link: "https://vectors.neuronpool.com/vectors/fi3zi-fyaaa-aaaaq-aachq-cai/45"
            },
            {
                id: "6",
                title: "Sneed DAO Treasury",
                description: "Main DAO treasury for ICP and SNEED",
                inputs: [
                    "ICP from Splitter (25%)", 
                    "SNEED from Splitter (33%)"
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
                    "SNEED from Splitter (34%)", 
                    "Tokens from Revenue"
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
                description: "Permanent SNEED removal from circulation",
                inputs: ["SNEED from Splitter (33%)"],
                outputs: [],
                canisterId: "fi3zi-fyaaa-aaaaq-aachq-cai"
            },
            {
                id: "9",
                title: "RLL Distribution Canister",
                description: "Distributes tokens to DAO voting members",
                inputs: ["Tokens from DeFi Canister"],
                outputs: ["100% to Sneed Members (Rewards claimable on app.sneeddao.com)"],
                canisterId: "lvc4n-7aaaa-aaaam-adm6a-cai",
                link: "https://app.sneeddao.com/rll"
            }
        ]
    },
    revenue: {
        title: "Revenue Sources",
        items: [
            {
                id: "11",
                title: "SNEED/ICP LP Rewards",
                description: "Liquidity provision rewards from ICPSwap",
                inputs: ["LP rewards"],
                outputs: ["ICP and SNEED rewards to Revenue Collector"],
                details: "Positions 24, 25 and 26",
                link: "https://info.icpswap.com/swap-scan/positions?pair=osyzs-xiaaa-aaaag-qc76q-cai"
            },
            {
                id: "13",
                title: "SneedLock",
                description: "Token and LP position locking product",
                inputs: ["User interactions"],
                outputs: ["ICP and SNEED revenue to Products"],
                link: "https://app.sneeddao.com/wallet"
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
                    description: "Maturity from 8y neuron to Neuron Vector",
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
                    description: "ICP compounding back to 8y neuron",
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
                percentage: "33%"
            },
            {
                id: "e7",
                source: "5",
                target: "7",
                description: "SNEED to DeFi Canister",
                token: "SNEED",
                percentage: "34%"
            },
            {
                id: "e8",
                source: "5",
                target: "8",
                description: "SNEED to Burn Address",
                token: "SNEED",
                percentage: "33%"
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
            label: '8 Year ICP NNS Neuron',
            description: "Long-term ICP staking neuron with 8-year dissolve delay",
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
            description: "Controls NNS Neuron and manages maturity collection",
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
            description: "Distributes ICP to multiple destinations with fixed proportions",
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
            description: "Purchases SNEED from market using ICP",
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
            description: "Distributes SNEED to multiple destinations with fixed proportions",
            inputs: ["SNEED from Buyback"],
            outputs: [
                "33% SNEED to Treasury",
                "34% SNEED to DeFi Canister",
                "33% SNEED to Burn Address"
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
            description: "Main DAO treasury for ICP and SNEED",
            inputs: [
                "ICP from Splitter (25%)", 
                "SNEED from Splitter (33%)"
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
                "SNEED from Splitter (34%)", 
                "Tokens from Revenue"
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
            description: "Permanent SNEED removal from circulation",
            inputs: ["SNEED from Splitter (33%)"],
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
            description: "Distributes tokens to DAO voting members",
            inputs: ["Tokens from DeFi Canister"],
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
            details: "Positions 24, 25 and 26",
            link: "https://info.icpswap.com/swap-scan/positions?pair=osyzs-xiaaa-aaaag-qc76q-cai"
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
            link: "https://app.sneeddao.com/wallet"
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
            description: "Maturity from 8y neuron to Neuron Vector",
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
            description: "ICP compounding back to 8y neuron",
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
        label: '33%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SNEED to Treasury",
            token: "SNEED",
            percentage: "33%"
        }
    },
    {
        id: 'e7',
        source: '5',
        target: '7',
        label: '34%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SNEED to DeFi Canister",
            token: "SNEED",
            percentage: "34%"
        }
    },
    {
        id: 'e8',
        source: '5',
        target: '8',
        label: '33%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
            description: "SNEED to Burn Address",
            token: "SNEED",
            percentage: "33%"
        }
    },

    // Revenue Flows
    {
        id: 'e10',
        source: '11',
        target: '10',
        label: 'LP Rewards to Revenue Collector',
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
        label: 'Product Revenue to Collector',
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
        label: 'ICP Revenue to ICP Splitter',
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
        label: 'SNEED Revenue to SNEED Splitter',
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
        label: 'Tokens to RLL Distribution',
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
        label: 'SneedLock Revenue',
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
        label: 'Swaprunner Revenue',
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
    const [expandedSections, setExpandedSections] = useState({});
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
    const [conversionRates, setConversionRates] = useState({
        ICP: 0,
        SNEED: 0
    });
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

    // Update effect to fetch conversion rates
    useEffect(() => {
        const fetchConversionRates = async () => {
            try {
                const neutriniteActor = createNeutriniteDappActor(Principal.fromText("u45jl-liaaa-aaaam-abppa-cai"));
                const tokens = await neutriniteActor.get_latest_wallet_tokens();
                const rates = {};
                
                tokens.latest.forEach(token => {
                    if (token.rates) {
                        token.rates.forEach(rate => {
                            if (rate.symbol.endsWith("/USD")) {
                                const tokenSymbol = rate.symbol.split("/")[0];
                                rates[tokenSymbol] = rate.rate;
                            }
                        });
                    }
                });
                
                setConversionRates(prevRates => ({
                    ...prevRates,
                    ...rates
                }));
            } catch (error) {
                console.error('Error fetching conversion rates:', error);
            }
        };

        fetchConversionRates();
    }, []);

    // Helper function to calculate USD value
    const getUSDValue = (amount, decimals, symbol) => {
        const value = Number(amount) / Math.pow(10, decimals);
        return value * conversionRates[symbol];
    };

    // Helper function to format USD
    const formatUSD = (value) => {
        return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // Update the neuron balance fetching effect
    useEffect(() => {
        const fetchNeuronBalance = async () => {
            setIsLoadingNeuron(true);
            try {
                const agent = new HttpAgent({
                    host: 'https://ic0.app'
                });
                await agent.fetchRootKey();
                
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
                await agent.fetchRootKey();

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
                await agent.fetchRootKey();

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
                await agent.fetchRootKey();

                const swapCanisterId = 'osyzs-xiaaa-aaaag-qc76q-cai';
                const swapActor = createIcpSwapActor(swapCanisterId, {
                    agentOptions: { agent }
                });
                
                // Get positions 24, 25, and 26
                const targetPositionIds = [24, 25, 26];
                const positions = [];
                
                const allPositions = await swapActor.getUserPositionWithTokenAmount(0, 50);
                if (allPositions.ok) {
                    for (const id of targetPositionIds) {
                        const position = allPositions.ok.content.find(p => Number(p.id) === id);
                        if (position) {
                            positions.push(position);
                        }
                    }
                }

                // Calculate totals
                const totals = positions.reduce((acc, pos) => {
                    acc.token0Amount += BigInt(pos.token0Amount || 0);
                    acc.token1Amount += BigInt(pos.token1Amount || 0);
                    acc.tokensOwed0 += BigInt(pos.tokensOwed0 || 0);
                    acc.tokensOwed1 += BigInt(pos.tokensOwed1 || 0);
                    return acc;
                }, {
                    token0Amount: BigInt(0),  // ICP
                    token1Amount: BigInt(0),  // SNEED
                    tokensOwed0: BigInt(0),   // Unclaimed ICP
                    tokensOwed1: BigInt(0)    // Unclaimed SNEED
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
                await agent.fetchRootKey();

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
                await agent.fetchRootKey();

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
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
        const vectorData = vectorInfo[vectorName];
        if (!vectorData || !vectorData.length || !vectorData[0] || !vectorData[0][0]) return null;
        
        const info = vectorData[0][0];
        if (!info) return null;

        return (
            <div style={{
                marginTop: '8px',
                padding: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '4px'
            }}>
                <div style={{ marginBottom: '4px' }}>Vector Status:</div>
                {isLoadingVectors ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                        <div style={styles.spinner} />
                    </div>
                ) : (
                    <>
                        <div>Active: {info.active.toString()}</div>
                        <div>Created: {formatNanoTimestamp(info.created)}</div>
                        <div>Last Modified: {formatNanoTimestamp(info.modified)}</div>
                        
                        {/* Billing Information */}
                        {info.billing && (
                            <div style={{ marginTop: '8px' }}>
                                <div style={{ fontWeight: 'bold' }}>Billing:</div>
                                <div style={{ marginLeft: '8px' }}>
                                    <div>Balance: {(Number(info.billing.current_balance) / 1e8).toFixed(8)} ICP</div>
                                    <div>Status: {info.billing.frozen ? 'Frozen' : 'Active'}</div>
                                    <div>Cost per day: {Number(info.billing.cost_per_day)} ICP</div>
                                </div>
                            </div>
                        )}

                        {/* Sources */}
                        {info.sources && info.sources.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                                <div style={{ fontWeight: 'bold' }}>Sources:</div>
                                {info.sources.map((source, idx) => {
                                    const nodeName = getNodeNameFromAccount(source.endpoint, source.endpoint.ic.ledger);
                                    return (
                                        <div key={idx} style={{ marginLeft: '8px' }}>
                                            • {source.name || 'Default'}: {(Number(source.balance) / 1e8).toFixed(8)} {getTokenSymbolFromLedger(source.endpoint.ic.ledger)}
                                            <div style={{ fontSize: '0.9em', color: '#888' }}>
                                                Account: 
                                                <div style={{
                                                    display: 'inline-block',
                                                    maxWidth: '100%',
                                                    wordBreak: 'break-all',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.9em',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                                    padding: '2px 4px',
                                                    borderRadius: '3px',
                                                    margin: '2px 0'
                                                }}>
                                                    {formatIcrc1Account(source.endpoint)}
                                                </div>
                                                {nodeName && <span style={{ color: '#3498db' }}> ({nodeName})</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Destinations */}
                        {info.destinations && info.destinations.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                                <div style={{ fontWeight: 'bold' }}>Destinations:</div>
                                {info.destinations.map((dest, idx) => {
                                    const nodeName = getNodeNameFromAccount(dest.endpoint, dest.endpoint.ic.ledger);
                                    return (
                                        <div key={idx} style={{ marginLeft: '8px' }}>
                                            • {dest.name}% {getTokenSymbolFromLedger(dest.endpoint.ic.ledger)}
                                            <div style={{ fontSize: '0.9em', color: '#888' }}>
                                                Account: 
                                                <div style={{
                                                    display: 'inline-block',
                                                    maxWidth: '100%',
                                                    wordBreak: 'break-all',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.9em',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                                    padding: '2px 4px',
                                                    borderRadius: '3px',
                                                    margin: '2px 0'
                                                }}>
                                                    {formatIcrc1Account(dest.endpoint)}
                                                </div>
                                                {nodeName && <span style={{ color: '#3498db' }}> ({nodeName})</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
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
                        backgroundColor: '#2a2a2a',
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
                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                            (${formatUSD(getUSDValue(treasuryBalances.icp, 8, 'ICP'))})
                                        </span>
                                    </span>
                                </div>
                                <div style={styles.statusItem}>
                                    <span>SNEED:</span>
                                    <span>
                                        {(Number(treasuryBalances.sneed) / 1e8).toFixed(4)} SNEED
                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                            (${formatUSD(getUSDValue(treasuryBalances.sneed, 8, 'SNEED'))})
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
                        backgroundColor: '#2a2a2a',
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
                                    <span>{(Number(neuronBalance.voting_power) / 1e8).toFixed(2)} ICP</span>
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
                        backgroundColor: '#3a3a3a',
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
                                    <div style={{ color: '#3498db', marginBottom: '5px' }}>Position #{Number(position.id)}:</div>
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
                        backgroundColor: '#3a3a3a',
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
                        backgroundColor: '#3a3a3a',
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
                        backgroundColor: '#2a2a2a',
                        borderRadius: '6px'
                    }}>
                        <h4 style={{ margin: '0 0 15px 0', color: '#9b59b6' }}>Token Balances and Reconciliation</h4>
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
                                        backgroundColor: '#3a3a3a',
                                        borderRadius: '4px'
                                    }}>
                                        <div style={{ color: '#3498db', marginBottom: '8px', fontWeight: 'bold' }}>
                                            Token: {tokenInfo.symbol}
                                        </div>
                                        <div style={{ marginLeft: '10px' }}>
                                            <div>All-Time Distributed: {(Number(reconciliation.total_distributed) / Math.pow(10, tokenInfo.decimals)).toFixed(8)} {tokenInfo.symbol}</div>
                                            <div>Currently Claimable: {(Number(reconciliation.local_total) / Math.pow(10, tokenInfo.decimals)).toFixed(8)} {tokenInfo.symbol}</div>
                                            <div>Server Balance: {(Number(reconciliation.server_balance) / Math.pow(10, tokenInfo.decimals)).toFixed(8)} {tokenInfo.symbol}</div>
                                            <div style={{ color: Number(reconciliation.remaining) > 0 ? '#2ecc71' : '#ffffff' }}>
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

    // Update handleNodeMouseEnter to include vector info
    const handleNodeMouseEnter = useCallback((event, node) => {
        const content = (
            <div>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#3498db' }}>{node.data.label}</div>
                <div style={{ marginBottom: '8px' }}>{node.data.description}</div>
                {node.data.inputs && (
                    <div>
                        <div style={{ color: '#2ecc71', marginBottom: '4px' }}>Inputs:</div>
                        <ul style={{ margin: '0 0 8px 16px', padding: 0 }}>
                            {node.data.inputs.map((input, i) => (
                                <li key={i}>{input}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {node.data.outputs && (
                    <div>
                        <div style={{ color: '#e74c3c', marginBottom: '4px' }}>Outputs:</div>
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
                        color: '#95a5a6',
                        marginTop: '8px'
                    }}>
                        Canister ID: {node.data.canisterId}
                    </div>
                )}
                {node.id === '1' && neuronBalance && (
                    <div style={{
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
                                    <span>{(Number(neuronBalance.voting_power) / 1e8).toFixed(2)} ICP</span>
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
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        borderRadius: '4px'
                    }}>
                        <div style={{ marginBottom: '4px' }}>Total LP Position Status:</div>
                        {isLoadingLp ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                <div style={styles.spinner} />
                            </div>
                        ) : lpPositions.totals ? (
                            <>
                                <div style={{ color: '#3498db' }}>Total Current Position:</div>
                                <div>• {(Number(lpPositions.totals.token0Amount) / 1e8).toFixed(4)} SNEED</div>
                                <div>• {(Number(lpPositions.totals.token1Amount) / 1e8).toFixed(4)} ICP</div>
                                <div style={{ color: '#2ecc71', marginTop: '8px' }}>Total Unclaimed Rewards:</div>
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
                        backgroundColor: '#3a3a3a',
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
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
        
        setTooltip({
            content,
            x: event.clientX,
            y: event.clientY
        });
    }, [treasuryBalances, isLoadingBalances, neuronBalance, isLoadingNeuron, vectorInfo, isLoadingVectors, lpPositions, isLoadingLp, defiBalances, reconciliationData, knownTokens, isLoadingRllData]);

    const handleEdgeMouseEnter = useCallback((event, edge) => {
        const content = (
            <div>
                <div style={{ marginBottom: '8px' }}>{edge.data?.description}</div>
                {edge.data?.token && (
                    <div style={{ color: '#f1c40f' }}>Token: {edge.data.token}</div>
                )}
                {edge.data?.percentage && (
                    <div style={{ color: '#3498db' }}>Percentage: {edge.data.percentage}</div>
                )}
            </div>
        );
        
        setTooltip({
            content,
            x: event.clientX,
            y: event.clientY
        });
    }, []);

    const handleMouseLeave = useCallback(() => {
        setTooltip(null);
    }, []);

    const handleMouseMove = useCallback((event) => {
        if (tooltip) {
            setTooltip(prev => ({
                ...prev,
                x: event.clientX,
                y: event.clientY
            }));
        }
    }, [tooltip]);

    const handleNodeClick = useCallback((event, node) => {
        if (node.data.link) {
            window.open(node.data.link, '_blank');
        }
    }, []);

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
                await agent.fetchRootKey();

                // ICP/CLOWN position
                const swapActor = createIcpSwapActor('bdki3-ciaaa-aaaag-qj67a-cai', {
                    agentOptions: { agent }
                });
                
                const allPositions = await swapActor.getUserPositionWithTokenAmount(0, 200);
                if (allPositions.ok) {
                    const position = allPositions.ok.content.find(p => Number(p.id) === 168);
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
        Object.entries(defiKnownTokens)
            .filter(([id]) => id !== 'ryjl3-tyaaa-aaaaa-aaaba-cai' && id !== 'hvgxa-wqaaa-aaaaq-aacia-cai')
            .forEach(([tokenId, tokenInfo]) => {
                const balance = defiTokenBalances[tokenId.toString()];
                if (balance) {
                    const usdValue = getUSDValue(balance, tokenInfo.decimals, tokenInfo.symbol);
                    if (!isNaN(usdValue)) {
                        total += usdValue;
                    }
                }
            });

        // Add RLL Distribution balances
        reconciliationData.forEach(rllBalance => {
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

    return (
        <div className='page-container'>
            <header className="site-header">
                <div style={headerStyles.logoContainer}>
                    <div className="logo">
                        <Link to="/wallet">
                            <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
                        </Link>
                    </div>
                    <Link to="/rll" style={headerStyles.rllLogo}>
                        RLL
                    </Link>
                </div>
                <div className="header-right">
                    <Link to="/help" className="help-link">Help</Link>
                    <PrincipalBox 
                        principalText={identity ? identity.getPrincipal().toText() : "Not logged in."}
                        onLogout={logout}
                    />
                </div>
            </header>
            <main className="rllinfo-container" style={{
                width: '100%',
                maxWidth: '100%',
                margin: '0 auto',
                padding: '20px',
                overflow: 'hidden'  // Prevent overflow issues
            }}>
                <h1 style={{ color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Recursive Liquidity Loop (RLL)
                    <span 
                        style={styles.infoIcon} 
                        title="A comprehensive system for managing DAO treasury assets, automating token distributions, and maintaining liquidity across multiple protocols"
                    >
                        i
                    </span>
                </h1>
                
                <div className="rll-layout" style={{
                    display: 'grid',
                    gap: '40px',
                    width: '100%',
                    minWidth: '0',
                    minHeight: '0',
                    gridTemplateAreas: "'assets' 'flow' 'details'",
                    gridTemplateColumns: '1fr',
                    justifyItems: 'center'
                }}>
                    {/* Total Assets Section */}
                    <section style={{
                        ...styles.section, 
                        gridArea: 'assets',
                        width: '100%',
                        maxWidth: '800px',
                        alignSelf: 'start'
                    }}>
                        <h2 style={{ ...styles.heading }}>
                            Total Assets Overview
                            <span 
                                style={styles.infoIcon} 
                                title="Comprehensive overview of all DAO assets across different protocols, including treasury holdings, staked positions, LP positions, and tokens pending distribution"
                            >
                                i
                            </span>
                        </h2>
                        {/* Remove the nested grid, just stack items vertically */}
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px'
                        }}>
                            {/* Grand Total in USD */}
                            <div style={{
                                backgroundColor: '#1a1a1a',
                                padding: '20px',
                                borderRadius: '6px',
                                border: '1px solid #f1c40f',
                                marginBottom: '20px'
                            }}>
                                <h3 style={{ color: '#f1c40f', marginTop: 0, marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    Total Value (USD)
                                    <span 
                                        style={styles.infoIcon} 
                                        title="Combined USD value of all DAO assets, including ICP and SNEED holdings across all protocols and positions"
                                    >
                                        i
                                    </span>
                                </h3>
                                {isLoadingBalances || isLoadingNeuron || isLoadingLp ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                        <div style={styles.spinner} />
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '1.6em', fontWeight: 'bold' }}>
                                        ${formatUSD(
                                            // ICP total in USD
                                            getUSDValue(treasuryBalances.icp, 8, 'ICP') +
                                            getUSDValue(neuronBalance?.stake_e8s || 0, 8, 'ICP') +
                                            getUSDValue(lpPositions.totals.token1Amount, 8, 'ICP') +
                                            getUSDValue(lpPositions.totals.tokensOwed1, 8, 'ICP') +
                                            getUSDValue(defiBalances.icp, 8, 'ICP') +
                                            // SNEED total in USD
                                            getUSDValue(treasuryBalances.sneed, 8, 'SNEED') +
                                            getUSDValue(lpPositions.totals.token0Amount, 8, 'SNEED') +
                                            getUSDValue(lpPositions.totals.tokensOwed0, 8, 'SNEED') +
                                            getUSDValue(defiBalances.sneed, 8, 'SNEED')
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* ICP Assets */}
                            <div style={{
                                backgroundColor: '#1a1a1a',
                                padding: '20px',
                                borderRadius: '6px',
                                border: '1px solid #3498db',
                                marginBottom: '20px'
                            }}>
                                <h3 
                                    onClick={() => toggleSection('icpAssets')}
                                    style={{ 
                                        color: '#3498db', 
                                        marginTop: 0,
                                        marginBottom: '15px',
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '8px',
                                        cursor: 'pointer' 
                                    }}
                                >
                                    <span style={{ 
                                        display: 'inline-block',
                                        transform: `rotate(${expandedSections.icpAssets ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        marginRight: '4px'
                                    }}>▸</span>
                                    ICP Assets
                                    <span 
                                        style={styles.infoIcon} 
                                        title="All ICP holdings across Treasury, Neurons, LP positions, DeFi canister, and other protocols"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        i
                                    </span>
                                </h3>
                                
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
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/account/580deb37eb3583e5854516481bd52c2618ca73ef6ee1c2df2b556bf85c0ce5a9"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            Treasury:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(treasuryBalances.icp) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(treasuryBalances.icp, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/neuron/4000934039483276792"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            8 Year Neuron:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(neuronBalance?.stake_e8s || 0) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(neuronBalance?.stake_e8s || 0, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://info.icpswap.com/swap-scan/positions?pair=osyzs-xiaaa-aaaag-qc76q-cai"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            ICP/SNEED LP:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.token1Amount) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(lpPositions.totals.token1Amount, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>Unclaimed LP Rewards:</div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.tokensOwed1) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(lpPositions.totals.tokensOwed1, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/canister/ok64y-uiaaa-aaaag-qdcbq-cai"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            DeFi Canister:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(defiBalances.icp) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(defiBalances.icp, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://app.sneeddao.com/rll"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            RLL Distribution:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(rllBalances.icp) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(rllBalances.icp, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                {vectorInfo['SNEED Buyback Vector']?.[0]?.[0]?.sources?.[0]?.balance && (
                                                    <div style={{ marginBottom: '15px' }}>
                                                        <div style={{ color: '#888', marginBottom: '5px' }}>
                                                            <a 
                                                                href="https://beta.icpcoins.com/#/vector/modify/togwv-zqaaa-aaaal-qr7aa-cai/exchange/18"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                            >
                                                                Buyback Vector:
                                                            </a>
                                                        </div>
                                                        <div style={{ fontSize: '1.1em' }}>
                                                            {(Number(vectorInfo['SNEED Buyback Vector'][0][0].sources[0].balance) / 1e8).toFixed(4)} ICP
                                                            <span style={{ color: '#888', marginLeft: '8px' }}>
                                                                (${formatUSD(getUSDValue(vectorInfo['SNEED Buyback Vector'][0][0].sources[0].balance, 8, 'ICP'))})
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>Other Pools:</div>
                                                    {otherLpPositions['ICP/CLOWN'].loading ? (
                                                        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                                                            <div style={styles.spinner} />
                                                        </div>
                                                    ) : otherLpPositions['ICP/CLOWN'].error ? (
                                                        <div style={{ color: '#e74c3c' }}>Error loading ICP/CLOWN position</div>
                                                    ) : otherLpPositions['ICP/CLOWN'].position ? (
                                                        <div style={{ marginLeft: '15px' }}>
                                                            <div style={{ marginBottom: '8px' }}>
                                                                <a 
                                                                    href="https://info.icpswap.com/swap-scan/positions?pair=bdki3-ciaaa-aaaag-qj67a-cai"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                                >
                                                                    ICP/CLOWN LP:
                                                                </a>
                                                            </div>
                                                            <div style={{ fontSize: '1em', marginLeft: '10px' }}>
                                                                • Position: {(Number(otherLpPositions['ICP/CLOWN'].position.token1Amount) / 1e8).toFixed(4)} ICP
                                                                <span style={{ color: '#888', marginLeft: '8px' }}>
                                                                    (${formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.token1Amount, 8, 'ICP'))})
                                                                </span>
                                                            </div>
                                                            {Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed1) > 0 && (
                                                                <div style={{ fontSize: '1em', marginLeft: '10px' }}>
                                                                    • Unclaimed: {(Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed1) / 1e8).toFixed(4)} ICP
                                                                    <span style={{ color: '#888', marginLeft: '8px' }}>
                                                                        (${formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.tokensOwed1, 8, 'ICP'))})
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div style={{ color: '#888', marginLeft: '15px' }}>No positions found</div>
                                                    )}
                                                    <div style={{ fontSize: '1.1em', marginTop: '10px', borderTop: '1px solid #333', paddingTop: '10px' }}>
                                                        Total: {(Number(getOtherPoolsIcpTotal()) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(getOtherPoolsIcpTotal(), 8, 'ICP'))})
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
                                    borderTop: '1px solid #3498db'
                                }}>
                                    <div style={{ color: '#3498db', marginBottom: '5px' }}>Total ICP:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        {((Number(treasuryBalances.icp) + 
                                           Number(neuronBalance?.stake_e8s || 0) + 
                                           Number(lpPositions.totals.token1Amount) +
                                           Number(lpPositions.totals.tokensOwed1) +
                                           Number(defiBalances.icp) +
                                           Number(rllBalances.icp) +
                                           Number(vectorInfo['SNEED Buyback Vector']?.[0]?.[0]?.sources?.[0]?.balance || 0) +
                                           Number(getOtherPoolsIcpTotal())) / 1e8).toFixed(4)} ICP
                                        <span style={{ color: '#888', marginLeft: '8px', fontSize: '0.8em' }}>
                                            (${formatUSD(
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
                                backgroundColor: '#1a1a1a',
                                padding: '20px',
                                borderRadius: '6px',
                                border: '1px solid #2ecc71',
                                marginBottom: '20px'
                            }}>
                                <h3 
                                    onClick={() => toggleSection('sneedAssets')}
                                    style={{ 
                                        color: '#2ecc71', 
                                        marginTop: 0,
                                        marginBottom: '15px',
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '8px',
                                        cursor: 'pointer' 
                                    }}
                                >
                                    <span style={{ 
                                        display: 'inline-block',
                                        transform: `rotate(${expandedSections.sneedAssets ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        marginRight: '4px'
                                    }}>▸</span>
                                    SNEED Assets
                                    <span 
                                        style={styles.infoIcon} 
                                        title="All SNEED holdings across Treasury, LP positions, DeFi canister, and pending distributions"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        i
                                    </span>
                                </h3>

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
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://dashboard.internetcomputer.org/sns/fp274-iaaaa-aaaaq-aacha-cai/account/fi3zi-fyaaa-aaaaq-aachq-cai-laerbmy.8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            Treasury:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(treasuryBalances.sneed) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(treasuryBalances.sneed, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://info.icpswap.com/swap-scan/positions?pair=osyzs-xiaaa-aaaag-qc76q-cai"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            ICP/SNEED LP:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.token0Amount) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(lpPositions.totals.token0Amount, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>Unclaimed LP Rewards:</div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(lpPositions.totals.tokensOwed0) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(lpPositions.totals.tokensOwed0, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>DeFi Canister:</div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(defiBalances.sneed) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(defiBalances.sneed, 8, 'SNEED'))})
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: '15px' }}>
                                                    <div style={{ color: '#888', marginBottom: '5px' }}>
                                                        <a 
                                                            href="https://app.sneeddao.com/rll"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#3498db', textDecoration: 'none', ':hover': { textDecoration: 'underline' } }}
                                                        >
                                                            RLL Distribution:
                                                        </a>
                                                    </div>
                                                    <div style={{ fontSize: '1.1em' }}>
                                                        {(Number(rllBalances.sneed) / 1e8).toFixed(4)} SNEED
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(rllBalances.sneed, 8, 'SNEED'))})
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
                                    borderTop: '1px solid #2ecc71'
                                }}>
                                    <div style={{ color: '#2ecc71', marginBottom: '5px' }}>Total SNEED:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        {((Number(treasuryBalances.sneed) + 
                                           Number(lpPositions.totals.token0Amount) +
                                           Number(lpPositions.totals.tokensOwed0) +
                                           Number(defiBalances.sneed) +
                                           Number(rllBalances.sneed)) / 1e8).toFixed(4)} SNEED
                                        <span style={{ color: '#888', marginLeft: '8px', fontSize: '0.8em' }}>
                                            (${formatUSD(
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
                                backgroundColor: '#1a1a1a',
                                padding: '20px',
                                borderRadius: '6px',
                                border: '1px solid #9b59b6',
                                marginBottom: '20px'
                            }}>
                                <h3 
                                    onClick={() => toggleSection('otherTokens')}
                                    style={{ 
                                        color: '#9b59b6', 
                                        marginTop: 0, 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '8px',
                                        cursor: 'pointer' 
                                    }}
                                >
                                    <span style={{ 
                                        display: 'inline-block',
                                        transform: `rotate(${expandedSections.otherTokens ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        marginRight: '4px'
                                    }}>▸</span>
                                    Other Tokens
                                    <span 
                                        style={styles.infoIcon} 
                                        title="Additional token holdings in the DeFi canister and RLL Distribution system"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        i
                                    </span>
                                </h3>
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
                                                        color: '#3498db', 
                                                        fontSize: '1.1em', 
                                                        fontWeight: 'bold',
                                                        marginBottom: '15px',
                                                        borderBottom: '1px solid #3498db',
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
                                                                            <span style={{ color: '#888', marginLeft: '8px' }}>
                                                                                (${formatUSD(usdValue)})
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
                                                        color: '#9b59b6', 
                                                        fontSize: '1.1em', 
                                                        fontWeight: 'bold',
                                                        marginBottom: '15px',
                                                        borderBottom: '1px solid #9b59b6',
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
                                                                            <span style={{ color: '#888', marginLeft: '8px' }}>
                                                                                (${formatUSD(getUSDValue(rllBalance.server_balance, tokenInfo.decimals, tokenInfo.symbol))})
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
                                    borderTop: '1px solid #9b59b6'
                                }}>
                                    <div style={{ color: '#9b59b6', marginBottom: '5px' }}>Total Value:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        ${formatUSD(getOtherTokensUSDTotal())}
                                    </div>
                                </div>
                            </div>

                            {/* Other Positions */}
                            <div style={{
                                backgroundColor: '#1a1a1a',
                                padding: '20px',
                                borderRadius: '6px',
                                border: '1px solid #9b59b6',
                                marginBottom: '20px'
                            }}>
                                <h3 style={{ 
                                    color: '#9b59b6', 
                                    marginTop: 0, 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '8px',
                                    cursor: 'pointer' 
                                }}
                                    onClick={() => toggleSection('otherPositions')}
                                >
                                    <span style={{ 
                                        display: 'inline-block',
                                        transform: `rotate(${expandedSections.otherPositions ? '90deg' : '0deg'})`,
                                        transition: 'transform 0.2s ease',
                                        marginRight: '4px'
                                    }}>▸</span>
                                    Other Positions
                                    <span 
                                        style={styles.infoIcon} 
                                        title="Additional liquidity positions and holdings in other protocols"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        i
                                    </span>
                                </h3>

                                {expandedSections.otherPositions && (
                                    <>
                                        {otherLpPositions['ICP/CLOWN'].loading ? (
                                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                                                <div style={styles.spinner} />
                                            </div>
                                        ) : otherLpPositions['ICP/CLOWN'].error ? (
                                            <div style={{ color: '#e74c3c' }}>Error loading ICP/CLOWN position: {otherLpPositions['ICP/CLOWN'].error}</div>
                                        ) : otherLpPositions['ICP/CLOWN'].position && (
                                            <div style={{
                                                marginBottom: '15px',
                                                padding: '10px',
                                                backgroundColor: '#2a2a2a',
                                                borderRadius: '4px'
                                            }}>
                                                <div style={{ color: '#3498db', marginBottom: '8px', fontWeight: 'bold' }}>
                                                    ICP/CLOWN Position #168
                                                </div>
                                                <div style={{ marginLeft: '10px' }}>
                                                    <div>Current Position:</div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.token1Amount) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.token1Amount, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.token0Amount) / 1e8).toFixed(4)} CLOWN
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.token0Amount, 8, 'CLOWN'))})
                                                        </span>
                                                    </div>
                                                    <div style={{ marginTop: '5px' }}>Unclaimed Rewards:</div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed1) / 1e8).toFixed(4)} ICP
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.tokensOwed1, 8, 'ICP'))})
                                                        </span>
                                                    </div>
                                                    <div>• {(Number(otherLpPositions['ICP/CLOWN'].position.tokensOwed0) / 1e8).toFixed(4)} CLOWN
                                                        <span style={{ color: '#888', marginLeft: '8px' }}>
                                                            (${formatUSD(getUSDValue(otherLpPositions['ICP/CLOWN'].position.tokensOwed0, 8, 'CLOWN'))})
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
                                    borderTop: '1px solid #9b59b6'
                                }}>
                                    <div style={{ color: '#9b59b6', marginBottom: '5px' }}>Total Value:</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: 'bold' }}>
                                        ${formatUSD(getOtherPositionsUSDTotal())}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Flow Diagram Section */}
                    <section style={{
                        ...styles.section, 
                        gridArea: 'flow',
                        width: '100%',
                        maxWidth: '800px',
                        height: '800px',
                        minWidth: '0',
                        minHeight: '0',
                        overflow: 'hidden'
                    }}>
                        <h2 style={{ ...styles.heading }}>
                            System Flow Diagram
                            <span 
                                style={styles.infoIcon} 
                                title="Interactive visualization of token flows between different system components. Hover over nodes and edges for detailed information. Click nodes to visit relevant external links."
                            >
                                i
                            </span>
                        </h2>
                        <div style={{
                            position: 'relative',
                            width: '100%',
                            height: 'calc(100% - 40px)',
                            backgroundColor: '#1a1a1a',
                            borderRadius: '8px',
                            overflow: 'hidden'
                        }}>
                            <ReactFlow
                                nodes={initialNodes}
                                edges={initialEdges}
                                fitView
                                defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
                                onNodeMouseEnter={handleNodeMouseEnter}
                                onNodeMouseLeave={handleMouseLeave}
                                onEdgeMouseEnter={handleEdgeMouseEnter}
                                onEdgeMouseLeave={handleMouseLeave}
                                onMouseMove={handleMouseMove}
                                onNodeClick={handleNodeClick}
                                style={{ width: '100%', height: '100%' }}
                            >
                                <Background color="#444" gap={16} />
                                <Controls />
                                <TokenAnimationManager edges={initialEdges} nodes={initialNodes} />
                                <TooltipOverlay tooltip={tooltip} />
                            </ReactFlow>
                        </div>
                    </section>

                    {/* Combined Details Section */}
                    <section style={{
                        ...styles.section, 
                        gridArea: 'details',
                        width: '100%',
                        maxWidth: '800px',
                        alignSelf: 'start'
                    }}>
                        <h2 style={{ ...styles.heading }}>
                            System Components
                            <span 
                                style={styles.infoIcon} 
                                title="Detailed information about each component in the system, including infrastructure nodes, token management canisters, and revenue sources"
                            >
                                i
                            </span>
                        </h2>
                        {Object.entries(nodes).map(([key, section]) => (
                            <div key={key}>
                                <div 
                                    style={styles.expandableHeader}
                                    onClick={() => toggleSection(key)}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>{section.title}</span>
                                        <span 
                                            style={styles.infoIcon} 
                                            title={section.description || `Details about ${section.title} components and their functions in the system`}
                                        >
                                            i
                                        </span>
                                    </div>
                                    <span>{expandedSections[key] ? '▼' : '▶'}</span>
                                </div>
                                {expandedSections[key] && (
                                    <div style={styles.content}>
                                        {section.items.map(item => (
                                            <div key={item.id} style={styles.item}>
                                                <div 
                                                    style={styles.itemHeader}
                                                    onClick={() => toggleItem(item.id)}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span>{item.title}</span>
                                                        <span 
                                                            style={styles.infoIcon} 
                                                            title={item.description}
                                                        >
                                                            i
                                                        </span>
                                                    </div>
                                                    <span>{expandedItems[item.id] ? '▼' : '▶'}</span>
                                                </div>
                                                {expandedItems[item.id] && renderItemDetails(item)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        <h2 style={{ marginTop: '40px', ...styles.heading }}>
                            Token Flows
                            <span 
                                style={styles.infoIcon} 
                                title="Detailed breakdown of token movement paths between system components, including percentages and token types"
                            >
                                i
                            </span>
                        </h2>
                        {Object.entries(edges).map(([key, section]) => (
                            <div key={key}>
                                <div 
                                    style={styles.expandableHeader}
                                    onClick={() => toggleSection(key + '_edges')}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>{section.title}</span>
                                        <span 
                                            style={styles.infoIcon} 
                                            title={`Token flow paths for ${section.title}, showing how tokens move between components`}
                                        >
                                            i
                                        </span>
                                    </div>
                                    <span>{expandedSections[key + '_edges'] ? '▼' : '▶'}</span>
                                </div>
                                {expandedSections[key + '_edges'] && (
                                    <div style={styles.content}>
                                        {section.items.map(item => (
                                            <div key={item.id} style={styles.item}>
                                                <div 
                                                    style={styles.itemHeader}
                                                    onClick={() => toggleItem(item.id)}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span>{item.description}</span>
                                                        <span 
                                                            style={styles.infoIcon} 
                                                            title={`Token flow from ${item.source} to ${item.target} (${item.percentage} of ${item.token})`}
                                                        >
                                                            i
                                                        </span>
                                                    </div>
                                                    <span>{expandedItems[item.id] ? '▼' : '▶'}</span>
                                                </div>
                                                {expandedItems[item.id] && (
                                                    <div style={styles.itemContent}>
                                                        <p>Token: {item.token}</p>
                                                        <p>From: {nodes.infrastructure.items.concat(
                                                            nodes.tokenManagement.items,
                                                            nodes.revenue.items
                                                        ).find(n => n.id === item.source)?.title}</p>
                                                        <p>To: {nodes.infrastructure.items.concat(
                                                            nodes.tokenManagement.items,
                                                            nodes.revenue.items
                                                        ).find(n => n.id === item.target)?.title}</p>
                                                        <p>Percentage: {item.percentage}</p>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </section>
                </div>

                <style>
                    {`
                        @media (min-width: 1600px) {
                            .rll-layout {
                                grid-template-columns: 400px minmax(600px, 1fr) 500px !important;
                                grid-template-areas: "assets flow details" !important;
                                gap: 20px;
                                max-width: 1800px;
                                margin: 0 auto;
                                padding: 0 20px;
                                justifyItems: stretch;
                            }

                            .long-account-string {
                                display: inline-block;
                                max-width: 100%;
                                word-break: break-all;
                                font-family: monospace;
                                font-size: 0.9em;
                                background-color: rgba(0, 0, 0, 0.2);
                                padding: 2px 4px;
                                border-radius: 3px;
                                margin: 2px 0;
                            }

                            .rll-layout > section[style*="gridArea: assets"] {
                                width: 400px !important;
                                max-width: 400px !important;
                            }

                            .rll-layout > section[style*="gridArea: flow"] {
                                width: 100% !important;
                                max-width: unset !important;
                                min-width: 600px !important;
                            }

                            .rll-layout > section[style*="gridArea: details"] {
                                width: 500px !important;
                                max-width: 500px !important;
                                overflow-x: hidden !important;
                            }

                            /* Comprehensive text wrapping for all content types */
                            .rll-layout > section[style*="gridArea: details"] * {
                                overflow-wrap: break-word !important;
                                word-wrap: break-word !important;
                                word-break: break-word !important;
                                hyphens: auto !important;
                            }

                            .rll-layout > section[style*="gridArea: details"] .item-content {
                                max-width: 100% !important;
                                padding-right: 10px !important;
                            }

                            .rll-layout > section[style*="gridArea: details"] .canisterId,
                            .rll-layout > section[style*="gridArea: details"] .icrc1Account,
                            .rll-layout > section[style*="gridArea: details"] pre,
                            .rll-layout > section[style*="gridArea: details"] code {
                                max-width: 100% !important;
                                white-space: pre-wrap !important;
                                font-family: monospace !important;
                            }

                            /* Ensure expandable headers don't overflow */
                            .rll-layout > section[style*="gridArea: details"] .expandableHeader {
                                display: flex !important;
                                align-items: center !important;
                                justify-content: space-between !important;
                                padding-right: 10px !important;
                            }

                            /* Add padding to nested content */
                            .rll-layout > section[style*="gridArea: details"] .detailsSection {
                                padding: 10px !important;
                                margin-right: 10px !important;
                            }

                            /* Ensure long URLs and links wrap properly */
                            .rll-layout > section[style*="gridArea: details"] a {
                                word-break: break-all !important;
                            }
                        }
                    `}
                </style>
            </main>
        </div>
    );
}

export default RLLInfo; 

// Add this to the style tag at the bottom
<style>
    {`
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        @keyframes pop-in {
            0% {
                transform: scale(0);
                opacity: 0;
            }
            50% {
                transform: scale(1.2);
                opacity: 0.7;
            }
            100% {
                transform: scale(1);
                opacity: 1;
            }
        }
        @keyframes burn-effect {
            0% {
                transform: translate(-50%, -50%) scale(0.5);
                opacity: 1;
            }
            50% {
                transform: translate(-50%, -60%) scale(2);
                opacity: 0.8;
            }
            100% {
                transform: translate(-50%, -70%) scale(0.1);
                opacity: 0;
            }
        }
    `}
</style> 