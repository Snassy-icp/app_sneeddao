import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import PrincipalBox from './PrincipalBox';
import { headerStyles } from './styles/HeaderStyles';
import ReactFlow, { 
    Background, 
    Controls,
    MiniMap
} from 'reactflow';
import 'reactflow/dist/style.css';

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
                outputs: ["Maturity to Neuron Vector"]
            },
            {
                id: "2",
                title: "ICP Neuron Vector",
                description: "Controls NNS Neuron and manages maturity collection",
                inputs: ["ICP from Splitter", "Maturity from NNS Neuron"],
                outputs: ["ICP to NNS Neuron"]
            },
            {
                id: "3",
                title: "ICP Splitter Vector",
                description: "Distributes ICP to multiple destinations",
                inputs: ["ICP"],
                outputs: ["ICP to Neuron Vector", "ICP to Buyback", "ICP to Treasury"]
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
                inputs: ["ICP from Splitter"],
                outputs: ["SNEED to SNEED Splitter"]
            },
            {
                id: "5",
                title: "SNEED Splitter Vector",
                description: "Distributes SNEED to multiple destinations",
                inputs: ["SNEED from Buyback"],
                outputs: ["SNEED to Treasury", "SNEED to DeFi", "SNEED to Burn", "SNEED to RLL"]
            },
            {
                id: "6",
                title: "Sneed DAO Treasury",
                description: "Main DAO treasury for ICP and SNEED",
                inputs: ["ICP from Splitter", "SNEED from Splitter"],
                outputs: ["Any via DAO proposal"]
            },
            {
                id: "7",
                title: "Sneed DeFi Canister",
                description: "Treasury extension for ICRC1 tokens",
                inputs: ["SNEED from Splitter", "Tokens from Revenue"],
                outputs: ["Any via DAO proposal", "Tokens to RLL"]
            },
            {
                id: "8",
                title: "SNEED Burn Address",
                description: "Permanent SNEED removal from circulation",
                inputs: ["SNEED from Splitter"],
                outputs: []
            },
            {
                id: "9",
                title: "RLL Distribution Canister",
                description: "Distributes tokens to DAO voting members",
                inputs: ["SNEED from Splitter", "Tokens from DeFi"],
                outputs: ["Tokens to DAO members"]
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
                description: "Liquidity provision rewards",
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

// Edge definitions
const edges = {
    icpFlows: {
        title: "ICP Flows",
        items: [
            {
                id: "e1",
                source: "2",
                target: "1",
                description: "Maturity collection from NNS Neuron",
                token: "ICP"
            },
            {
                id: "e2",
                source: "3",
                target: "2",
                description: "ICP compounding to Neuron",
                token: "ICP"
            },
            {
                id: "e3",
                source: "3",
                target: "4",
                description: "ICP for SNEED buyback",
                token: "ICP"
            },
            {
                id: "e4",
                source: "3",
                target: "6",
                description: "ICP to Treasury reserves",
                token: "ICP"
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
                token: "SNEED"
            },
            {
                id: "e6",
                source: "5",
                target: "6",
                description: "SNEED to Treasury",
                token: "SNEED"
            },
            {
                id: "e7",
                source: "5",
                target: "7",
                description: "SNEED to DeFi Canister",
                token: "SNEED"
            },
            {
                id: "e8",
                source: "5",
                target: "8",
                description: "SNEED to Burn Address",
                token: "SNEED"
            },
            {
                id: "e9",
                source: "5",
                target: "9",
                description: "SNEED to RLL Distribution",
                token: "SNEED"
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
                token: "Various"
            },
            {
                id: "e11",
                source: "12",
                target: "10",
                description: "Product Revenue to Collector",
                token: "Various"
            },
            {
                id: "e12",
                source: "10",
                target: "7",
                description: "Revenue to DeFi Canister",
                token: "Various"
            },
            {
                id: "e13",
                source: "7",
                target: "9",
                description: "Tokens to RLL Distribution",
                token: "Various"
            },
            {
                id: "e14",
                source: "13",
                target: "12",
                description: "SneedLock Revenue",
                token: "Various"
            },
            {
                id: "e15",
                source: "14",
                target: "12",
                description: "Swaprunner Revenue",
                token: "Various"
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
    }
};

// Initial nodes for React Flow
const initialNodes = [
    // We'll add the node positions in the next step
];

// Initial edges for React Flow
const initialEdges = [
    // We'll add the edge configurations in the next step
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
                        >
                            <Background />
                            <Controls />
                            <MiniMap />
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
                                            {expandedItems[item.id] && (
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
                                                </div>
                                            )}
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