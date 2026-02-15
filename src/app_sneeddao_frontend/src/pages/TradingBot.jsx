/**
 * TradingBot — Management page for a Sneed Trading Bot canister.
 *
 * Route: /trading_bot/:canisterId
 *
 * Uses the reusable BotManagementPanel for Info, Botkeys, Chores framework, and Log tabs.
 * The per-chore configuration panels are custom to the trading bot.
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import Header from '../components/Header';
import BotManagementPanel from '../components/BotManagementPanel';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
// Use staking bot declarations temporarily — the shared bot interface (botkeys, chores, logs)
// is identical. Swap to 'declarations/sneed_trading_bot' once the backend is built.
import { createActor as createBotActor } from 'declarations/sneed_icp_neuron_manager';
import { FaChartLine } from 'react-icons/fa';

// Trading bot accent colors — green/teal for trading
const ACCENT = '#10b981';
const ACCENT_SECONDARY = '#34d399';

// Trading Bot app ID (registered in the Sneedapp factory)
const APP_ID = 'sneed-trading-bot';

// Permission labels for the trading bot
const PERMISSION_LABELS = {
    'FullPermissions': 'Full Permissions',
    'ManagePermissions': 'Manage Permissions',
    'ViewChores': 'View Chores',
    'ViewLogs': 'Read Logs',
    'ManageLogs': 'Manage Logs',
    'ViewPortfolio': 'View Portfolio',
    'ManageSubaccounts': 'Manage Subaccounts',
    'ManageTrades': 'Manage Trades',
    'ManageRebalancer': 'Manage Rebalancer',
    'ManageTradeChore': 'Manage Trade Chore',
    'ManageRebalanceChore': 'Manage Rebalance Chore',
    'ManageMoveFundsChore': 'Manage Move Funds Chore',
    'ManageTokenRegistry': 'Manage Token Registry',
    'ManageDexSettings': 'Manage DEX Settings',
    'WithdrawFunds': 'Withdraw Funds',
    'ConfigureDistribution': 'Configure Distribution',
    'ManageDistributeFunds': 'Manage Distribute Funds',
};

const PERMISSION_DESCRIPTIONS = {
    'FullPermissions': 'Grants all permissions, including any added in future versions',
    'ManagePermissions': 'Add/remove botkey principals and manage their permissions',
    'ViewChores': 'View bot chore statuses, configurations, and settings',
    'ViewLogs': 'Read bot log entries and view log configuration',
    'ManageLogs': 'Set log level, max entries, and clear logs',
    'ViewPortfolio': 'View balances, subaccounts, and portfolio state',
    'ManageSubaccounts': 'Create, rename, and delete named subaccounts',
    'ManageTrades': 'Configure trade chore actions (add/edit/remove trades)',
    'ManageRebalancer': 'Configure rebalancer targets and parameters',
    'ManageTradeChore': 'Start/stop/pause/resume/trigger trade chores',
    'ManageRebalanceChore': 'Start/stop/pause/resume/trigger rebalance chore',
    'ManageMoveFundsChore': 'Start/stop/pause/resume/trigger move funds chores',
    'ManageTokenRegistry': 'Add/remove supported tokens from the registry',
    'ManageDexSettings': 'Configure DEX parameters (slippage, enabled DEXes)',
    'WithdrawFunds': 'Send tokens from the bot to external accounts',
    'ConfigureDistribution': 'Add, edit, and remove distribution lists',
    'ManageDistributeFunds': 'Start/stop/pause/resume/trigger distribute-funds chore',
};

// Chore types that support multiple instances
const MULTI_INSTANCE_CHORE_TYPES = ['trade', 'move-funds', 'distribute-funds', 'rebalance'];

// Custom chore configuration renderer
function renderTradingBotChoreConfig({ chore, config, choreTypeId, instanceId, getReadyBotActor, theme, accentColor, cardStyle, inputStyle, buttonStyle, secondaryButtonStyle }) {
    // Different config panels per chore type
    switch (choreTypeId) {
        case 'trade':
            return (
                <div style={cardStyle}>
                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                        Trade Actions
                    </h3>
                    <div style={{
                        padding: '16px',
                        background: `${accentColor}08`,
                        borderRadius: '8px',
                        border: `1px solid ${accentColor}20`,
                    }}>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                            Configure token swaps and fund movements that execute when this chore fires.
                            Each action can have conditions (balance thresholds, price ranges) and frequency limits.
                        </p>
                        <div style={{
                            marginTop: '12px',
                            padding: '12px',
                            background: theme.colors.primaryBg,
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.mutedText,
                            fontSize: '0.8rem',
                            textAlign: 'center',
                        }}>
                            Trade action configuration will be available once the trading bot backend is deployed.
                        </div>
                    </div>
                </div>
            );

        case 'rebalance':
            return (
                <div style={cardStyle}>
                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                        Rebalancer Configuration
                    </h3>
                    <div style={{
                        padding: '16px',
                        background: `${accentColor}08`,
                        borderRadius: '8px',
                        border: `1px solid ${accentColor}20`,
                    }}>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                            Set target portfolio allocations. The rebalancer identifies over/underweight tokens
                            and trades to bring the portfolio back to target using weighted-random pair selection.
                        </p>
                        <div style={{
                            marginTop: '12px',
                            padding: '12px',
                            background: theme.colors.primaryBg,
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.mutedText,
                            fontSize: '0.8rem',
                            textAlign: 'center',
                        }}>
                            Rebalancer configuration will be available once the trading bot backend is deployed.
                        </div>
                    </div>
                </div>
            );

        case 'move-funds':
            return (
                <div style={cardStyle}>
                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                        Move Funds Actions
                    </h3>
                    <div style={{
                        padding: '16px',
                        background: `${accentColor}08`,
                        borderRadius: '8px',
                        border: `1px solid ${accentColor}20`,
                    }}>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                            Schedule deposit, withdraw, and send operations between subaccounts and external addresses.
                        </p>
                        <div style={{
                            marginTop: '12px',
                            padding: '12px',
                            background: theme.colors.primaryBg,
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.mutedText,
                            fontSize: '0.8rem',
                            textAlign: 'center',
                        }}>
                            Move funds configuration will be available once the trading bot backend is deployed.
                        </div>
                    </div>
                </div>
            );

        case 'distribute-funds':
            return (
                <div style={cardStyle}>
                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                        Distribution Lists
                    </h3>
                    <div style={{
                        padding: '16px',
                        background: `${accentColor}08`,
                        borderRadius: '8px',
                        border: `1px solid ${accentColor}20`,
                    }}>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                            Configure percentage-based distribution lists to automatically split and send funds to multiple recipients.
                        </p>
                        <div style={{
                            marginTop: '12px',
                            padding: '12px',
                            background: theme.colors.primaryBg,
                            borderRadius: '6px',
                            border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.mutedText,
                            fontSize: '0.8rem',
                            textAlign: 'center',
                        }}>
                            Distribution configuration will be available once the trading bot backend is deployed.
                        </div>
                    </div>
                </div>
            );

        default:
            return null;
    }
}

export default function TradingBot() {
    const { canisterId } = useParams();
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();

    if (!canisterId) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📊</div>
                    <h1 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '8px' }}>
                        Trading Bot
                    </h1>
                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem' }}>
                        No canister ID provided. Navigate to a specific trading bot from your wallet or the Sneedapp page.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <Header />
            <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 60px' }}>
                {/* Page header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                    <div style={{
                        width: '44px', height: '44px', borderRadius: '12px',
                        background: `linear-gradient(135deg, ${ACCENT}30, ${ACCENT}10)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <FaChartLine style={{ color: ACCENT, fontSize: '20px' }} />
                    </div>
                    <div>
                        <h1 style={{ color: theme.colors.primaryText, fontSize: '1.3rem', margin: 0, fontWeight: '700' }}>
                            Sneed Trading Bot
                        </h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', fontFamily: 'monospace' }}>
                            {canisterId}
                        </div>
                    </div>
                </div>

                {/* Authentication check */}
                {!isAuthenticated ? (
                    <div style={{
                        background: theme.colors.cardGradient,
                        borderRadius: '12px',
                        border: `1px solid ${theme.colors.border}`,
                        padding: '2rem',
                        textAlign: 'center',
                    }}>
                        <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔐</div>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0' }}>Authentication Required</h3>
                        <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', margin: 0 }}>
                            Please log in with Internet Identity to manage this trading bot.
                        </p>
                    </div>
                ) : (
                    <BotManagementPanel
                        canisterId={canisterId}
                        createBotActor={createBotActor}
                        accentColor={ACCENT}
                        accentColorSecondary={ACCENT_SECONDARY}
                        botName="Trading Bot"
                        botIcon={<FaChartLine style={{ color: ACCENT, fontSize: '16px' }} />}
                        appId={APP_ID}
                        permissionLabels={PERMISSION_LABELS}
                        permissionDescriptions={PERMISSION_DESCRIPTIONS}
                        multiInstanceChoreTypes={MULTI_INSTANCE_CHORE_TYPES}
                        renderChoreConfig={renderTradingBotChoreConfig}
                        identity={identity}
                        isAuthenticated={isAuthenticated}
                    />
                )}
            </div>
        </div>
    );
}
