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

// Token animation manager component
const TokenAnimationManager = ({ edges, nodes }) => {
    const [tokens, setTokens] = useState([]);
    const [burnEffects, setBurnEffects] = useState([]);
    const reactFlowInstance = useReactFlow();

    const createToken = useCallback((edge, percentage = 1) => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        
        if (!sourceNode || !targetNode) return null;

        // Determine token type based on edge style
        const tokenType = edge.style === edgeStyles.icp ? 'icp' : 'sneed';
        const scale = percentage;

        // Check if target is burn address
        const isBurnDestination = targetNode.id === '8'; // ID of the SNEED Burn Address node

        return {
            id: `token-${edge.id}-${Date.now()}`,
            type: tokenType,
            edge: edge.id,
            scale,
            progress: 0,
            sourceX: sourceNode.position.x + (sourceNode.width || 180) / 2,
            sourceY: sourceNode.position.y + (sourceNode.height || 40) / 2,
            targetX: targetNode.position.x + (targetNode.width || 180) / 2,
            targetY: targetNode.position.y + (targetNode.height || 40) / 2,
            isBurnDestination
        };
    }, [nodes]);

    const animateTokens = useCallback(() => {
        setTokens(prevTokens => {
            const updatedTokens = prevTokens
                .map(token => ({
                    ...token,
                    progress: token.progress + 0.01
                }))
                .filter(token => {
                    // If token reaches burn address, create burn effect
                    if (token.isBurnDestination && token.progress >= 1) {
                        setBurnEffects(prev => [...prev, {
                            id: `burn-${Date.now()}`,
                            x: token.targetX,
                            y: token.targetY,
                            scale: token.scale,
                            createdAt: Date.now()
                        }]);
                    }
                    return token.progress <= 1;
                });

            // Create new tokens at source nodes
            edges.forEach(edge => {
                if (Math.random() < 0.005) {
                    const newToken = createToken(edge);
                    if (newToken) {
                        updatedTokens.push(newToken);
                    }
                }
            });

            // Handle token splitting at splitter nodes
            updatedTokens.forEach(token => {
                const edge = edges.find(e => e.id === token.edge);
                if (edge && token.progress >= 1) {
                    const outgoingEdges = edges.filter(e => e.source === edge.target);
                    if (outgoingEdges.length > 1) {
                        outgoingEdges.forEach(outEdge => {
                            const percentage = parseFloat(outEdge.label) / 100 || 1;
                            const newToken = createToken(outEdge, percentage);
                            if (newToken) {
                                updatedTokens.push({
                                    ...newToken,
                                    progress: 0
                                });
                            }
                        });
                    }
                }
            });

            return updatedTokens;
        });

        // Clean up old burn effects
        setBurnEffects(prev => prev.filter(effect => Date.now() - effect.createdAt < 500)); // Match animation duration
    }, [edges, createToken]);

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
        </>
    );
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
                details: "Controlled by ICP Neuron Vector for maturity collection and compounding"
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
                inputs: ["ICP from DeFi Canister"],
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
                canisterId: "togwv-zqaaa-aaaal-qr7aa-cai-ihr3xbq.100000000120000000000000000000000000000000000000000000000000000",
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
                canisterId: "fi3zi-fyaaa-aaaaq-aachq-cai"
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
                canisterId: "ok64y-uiaaa-aaaag-qdcbq-cai"
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
                canisterId: "lvc4n-7aaaa-aaaam-adm6a-cai"
            }
        ]
    },
    revenue: {
        title: "Revenue Sources",
        items: [
            {
                id: "10",
                title: "Other Revenue Sources",
                description: "Virtual collector for various revenue streams",
                inputs: ["Various token streams"],
                outputs: ["Tokens to DeFi Canister"]
            },
            {
                id: "11",
                title: "SNEED/ICP LP Rewards",
                description: "Liquidity provision rewards from ICPSwap",
                inputs: ["LP rewards"],
                outputs: ["Rewards to Revenue Collector"]
            },
            {
                id: "12",
                title: "Products",
                description: "Virtual collector for product revenue",
                inputs: ["Revenue from products"],
                outputs: ["Revenue to Revenue Collector"]
            },
            {
                id: "13",
                title: "SneedLock",
                description: "Token and LP position locking product",
                inputs: ["User interactions"],
                outputs: ["Revenue to Products"]
            },
            {
                id: "14",
                title: "Swaprunner",
                description: "Automated trading product",
                inputs: ["User interactions"],
                outputs: ["Revenue to Products"]
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
                source: "2",
                target: "1",
                description: "Maturity collection from NNS Neuron",
                token: "ICP",
                percentage: "100%"
            },
            {
                id: "e2",
                source: "3",
                target: "2",
                description: "ICP compounding to Neuron",
                token: "ICP",
                percentage: "25%"
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
                target: "7",
                description: "Revenue to DeFi Canister",
                token: "Various",
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
        marginBottom: '10px'
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
        width: '100%',
        height: '600px',
        backgroundColor: '#1a1a1a',
        borderRadius: '8px'
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
    }
};

// Add node styles after the existing styles object
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

// Define the initial nodes with positions
const initialNodes = [
    // Infrastructure nodes (top row)
    {
        id: '1',
        type: 'default',
        data: { label: '8 Year ICP NNS Neuron' },
        position: { x: 300, y: 50 },
        style: nodeStyles.infrastructure,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '2',
        type: 'default',
        data: { label: 'ICP Neuron Vector' },
        position: { x: 300, y: 150 },
        style: nodeStyles.infrastructure,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '3',
        type: 'default',
        data: { label: 'ICP Splitter Vector' },
        position: { x: 300, y: 250 },
        style: nodeStyles.infrastructure,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },

    // Token Management nodes (middle row)
    {
        id: '4',
        type: 'default',
        data: { label: 'SNEED Buyback Vector' },
        position: { x: 100, y: 350 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '5',
        type: 'default',
        data: { label: 'SNEED Splitter Vector' },
        position: { x: 300, y: 350 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '6',
        type: 'default',
        data: { label: 'Sneed DAO Treasury' },
        position: { x: 500, y: 350 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '7',
        type: 'default',
        data: { label: 'Sneed DeFi Canister' },
        position: { x: 300, y: 450 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '8',
        type: 'default',
        data: { label: 'SNEED Burn Address' },
        position: { x: 500, y: 450 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '9',
        type: 'default',
        data: { label: 'RLL Distribution' },
        position: { x: 300, y: 550 },
        style: nodeStyles.tokenManagement,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },

    // Revenue nodes (bottom row)
    {
        id: '10',
        type: 'default',
        data: { label: 'Other Revenue Sources' },
        position: { x: 100, y: 650 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '11',
        type: 'default',
        data: { label: 'SNEED/ICP LP Rewards' },
        position: { x: 300, y: 650 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '12',
        type: 'default',
        data: { label: 'Products' },
        position: { x: 500, y: 650 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '13',
        type: 'default',
        data: { label: 'SneedLock' },
        position: { x: 400, y: 750 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
    {
        id: '14',
        type: 'default',
        data: { label: 'Swaprunner' },
        position: { x: 600, y: 750 },
        style: nodeStyles.revenue,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
    },
];

// Define edge styles
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

// Define the initial edges with styles
const initialEdges = [
    // ICP Flows
    {
        id: 'e1',
        source: '2',
        target: '1',
        label: '100%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e2',
        source: '3',
        target: '2',
        label: '25%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e3',
        source: '3',
        target: '4',
        label: '50%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e4',
        source: '3',
        target: '6',
        label: '25%',
        type: 'smoothstep',
        style: edgeStyles.icp,
        markerEnd: { type: MarkerType.ArrowClosed },
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
    },
    {
        id: 'e6',
        source: '5',
        target: '6',
        label: '33%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e7',
        source: '5',
        target: '7',
        label: '34%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e8',
        source: '5',
        target: '8',
        label: '33%',
        type: 'smoothstep',
        style: edgeStyles.sneed,
        markerEnd: { type: MarkerType.ArrowClosed },
    },

    // Revenue Flows
    {
        id: 'e10',
        source: '11',
        target: '10',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e11',
        source: '12',
        target: '10',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e12',
        source: '10',
        target: '7',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e13',
        source: '7',
        target: '9',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e14',
        source: '13',
        target: '12',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
        id: 'e15',
        source: '14',
        target: '12',
        type: 'smoothstep',
        style: edgeStyles.various,
        markerEnd: { type: MarkerType.ArrowClosed },
    },
];

function RLLInfo() {
    const { identity, logout } = useAuth();
    const [expandedSections, setExpandedSections] = useState({});
    const [expandedItems, setExpandedItems] = useState({});

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
                    <p>Canister ID: <span style={styles.canisterId}>{item.canisterId}</span></p>
                )}
                {item.details && <p>{item.details}</p>}
                {item.link && (
                    <p>
                        <a 
                            href={item.link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={styles.link}
                        >
                            View on Platform →
                        </a>
                    </p>
                )}
            </div>
        </div>
    );

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
            <main className="help-container">
                <h1 style={{ color: '#ffffff' }}>Recursive Liquidity Loop (RLL)</h1>
                
                {/* Flow Diagram Section */}
                <section style={styles.section}>
                    <h2>System Flow Diagram</h2>
                    <div style={styles.flowContainer}>
                        <ReactFlow
                            nodes={initialNodes}
                            edges={initialEdges}
                            fitView
                            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
                        >
                            <Background color="#444" gap={16} />
                            <Controls />
                            <TokenAnimationManager edges={initialEdges} nodes={initialNodes} />
                        </ReactFlow>
                    </div>
                </section>

                {/* Nodes Section */}
                <section style={styles.section}>
                    <h2>System Components</h2>
                    {Object.entries(nodes).map(([key, section]) => (
                        <div key={key}>
                            <div 
                                style={styles.expandableHeader}
                                onClick={() => toggleSection(key)}
                            >
                                <span>{section.title}</span>
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
                                                {item.title} {expandedItems[item.id] ? '▼' : '▶'}
                                            </div>
                                            {expandedItems[item.id] && renderItemDetails(item)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </section>

                {/* Edges Section */}
                <section style={styles.section}>
                    <h2>Token Flows</h2>
                    {Object.entries(edges).map(([key, section]) => (
                        <div key={key}>
                            <div 
                                style={styles.expandableHeader}
                                onClick={() => toggleSection(key + '_edges')}
                            >
                                <span>{section.title}</span>
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
                                                {item.description} {expandedItems[item.id] ? '▼' : '▶'}
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