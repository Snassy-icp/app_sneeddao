import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { useNaming } from '../NamingContext';
import PrincipalInput from '../components/PrincipalInput';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext, getPrincipalProfileUrl, isCanisterPrincipal } from '../utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { FaCube, FaFilter, FaChevronRight, FaChevronLeft, FaExternalLinkAlt } from 'react-icons/fa';

const canistersPrimary = '#14b8a6';
const canistersSecondary = '#0d9488';
const canistersAccent = '#2dd4bf';

function Canisters() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const { principalNames, principalNicknames, verifiedNames } = useNaming();

    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
    const [nameTypeFilter, setNameTypeFilter] = useState('both'); // 'both' | 'public' | 'nicknames'

    // Get all named canister principals - only canisters; filter by name type
    const namedCanisterPrincipals = useMemo(() => {
        const principalIds = new Set();
        if (nameTypeFilter === 'both' || nameTypeFilter === 'public') {
            principalNames.forEach((_, id) => principalIds.add(id));
        }
        if (nameTypeFilter === 'both' || nameTypeFilter === 'nicknames') {
            principalNicknames.forEach((_, id) => principalIds.add(id));
        }

        return Array.from(principalIds).filter((principalId) => {
            try {
                const principal = Principal.fromText(principalId);
                return isCanisterPrincipal(principal);
            } catch {
                return false;
            }
        });
    }, [principalNames, principalNicknames, nameTypeFilter]);

    const getPrincipalDisplayInfo = (principalStr) => {
        try {
            return getPrincipalDisplayInfoFromContext(
                Principal.fromText(principalStr),
                principalNames,
                principalNicknames,
                verifiedNames
            );
        } catch {
            return null;
        }
    };

    // Filter and sort
    const filteredPrincipals = useMemo(() => {
        let filtered = namedCanisterPrincipals;

        if (searchTerm.trim()) {
            const searchLower = searchTerm.toLowerCase();
            filtered = filtered.filter((principalId) => {
                if (principalId.toLowerCase().includes(searchLower)) return true;
                const displayInfo = getPrincipalDisplayInfo(principalId);
                return (
                    displayInfo?.name?.toLowerCase().includes(searchLower) ||
                    displayInfo?.nickname?.toLowerCase().includes(searchLower)
                );
            });
        }

        return [...filtered].sort((a, b) => {
            const infoA = getPrincipalDisplayInfo(a);
            const infoB = getPrincipalDisplayInfo(b);
            const nameA = infoA?.name || infoA?.nickname || a;
            const nameB = infoB?.name || infoB?.nickname || b;
            const result = nameA.localeCompare(nameB);
            return sortConfig.direction === 'asc' ? result : -result;
        });
    }, [namedCanisterPrincipals, searchTerm, sortConfig, principalNames, principalNicknames]);

    const paginatedPrincipals = filteredPrincipals.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );
    const totalPages = Math.ceil(filteredPrincipals.length / itemsPerPage);

    const handlePrincipalSelect = (principalStr) => {
        if (principalStr) {
            navigate(getPrincipalProfileUrl(principalStr));
        }
    };

    return (
        <div className="page-container">
            <Header />
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <div
                    style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${canistersPrimary}15 50%, ${canistersSecondary}10 100%)`,
                        borderBottom: `1px solid ${theme.colors.border}`,
                        padding: '2rem 1.5rem',
                        position: 'relative',
                        overflow: 'hidden'
                    }}
                >
                    {/* Background decorations - match Users page */}
                    <div style={{
                        position: 'absolute', top: '-50%', right: '-10%', width: '400px', height: '400px',
                        background: `radial-gradient(circle, ${canistersPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute', bottom: '-30%', left: '-5%', width: '300px', height: '300px',
                        background: `radial-gradient(circle, ${canistersSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                            <div style={{
                                width: '56px', height: '56px',
                                minWidth: '56px', maxWidth: '56px',
                                flexShrink: 0,
                                borderRadius: '14px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    width: '100%', height: '100%',
                                    background: `linear-gradient(135deg, ${canistersPrimary}, ${canistersSecondary})`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: `0 4px 20px ${canistersPrimary}40`
                                }}>
                                    <FaCube size={24} color="white" />
                                </div>
                            </div>
                            <div>
                                <h1 style={{ color: theme.colors.primaryText, fontSize: '1.75rem', fontWeight: '700', margin: 0 }}>
                                    Canister Explorer
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
                                    Browse all canisters with public names or nicknames
                                </p>
                            </div>
                        </div>

                        <div style={{ marginTop: '1rem', maxWidth: '400px' }}>
                            <PrincipalInput
                                placeholder="Search or enter canister ID to view..."
                                defaultTab="all"
                                defaultPrincipalType="canisters"
                                onSelect={handlePrincipalSelect}
                                isAuthenticated={isAuthenticated}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                            <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <span style={{ color: canistersPrimary, fontWeight: '600' }}>{namedCanisterPrincipals.length.toLocaleString()}</span> named canisters
                            </span>
                            {filteredPrincipals.length !== namedCanisterPrincipals.length && (
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    <span style={{ color: canistersAccent, fontWeight: '600' }}>{filteredPrincipals.length.toLocaleString()}</span> matching filter
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem' }}>
                    <div
                        style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            marginBottom: '1.5rem',
                            border: `1px solid ${theme.colors.border}`
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '1rem'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <FaFilter size={14} color={canistersPrimary} />
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1rem' }}>
                                    Filters & Controls
                                </span>
                            </div>
                        </div>
                        <div style={{
                            display: 'flex',
                            gap: '1rem',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            marginTop: '1rem'
                        }}>
                            <div style={{ flex: '1 1 300px', minWidth: '200px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Filter:</span>
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => {
                                        setSearchTerm(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    placeholder="By name or canister ID..."
                                    style={{
                                        flex: 1,
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '10px',
                                        padding: '0.65rem 1rem',
                                        fontSize: '0.9rem'
                                    }}
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Show:</span>
                                <select
                                    value={nameTypeFilter}
                                    onChange={(e) => {
                                        setNameTypeFilter(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    style={{
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="both">Both (names & nicknames)</option>
                                    <option value="public">Public names only</option>
                                    <option value="nicknames">Nicknames only</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Per page:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => {
                                        setItemsPerPage(Number(e.target.value));
                                        setCurrentPage(1);
                                    }}
                                    style={{
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {paginatedPrincipals.map((principalId) => {
                            const displayInfo = getPrincipalDisplayInfo(principalId);
                            return (
                                <Link
                                    key={principalId}
                                    to={getPrincipalProfileUrl(principalId)}
                                    style={{
                                        backgroundColor: theme.colors.secondaryBg,
                                        borderRadius: '14px',
                                        padding: '1.25rem',
                                        border: `1px solid ${theme.colors.border}`,
                                        textDecoration: 'none',
                                        transition: 'all 0.3s ease',
                                        display: 'block'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <PrincipalDisplay
                                            principal={Principal.fromText(principalId)}
                                            displayInfo={displayInfo}
                                            short={false}
                                            noLink={true}
                                            isAuthenticated={isAuthenticated}
                                            showViewProfile={false}
                                            style={{ fontSize: '1rem' }}
                                        />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: canistersPrimary, fontSize: '0.85rem', fontWeight: '500' }}>
                                            View Profile
                                            <FaExternalLinkAlt size={10} />
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>

                    {filteredPrincipals.length === 0 && (
                        <div
                            style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                padding: '3rem',
                                textAlign: 'center',
                                border: `1px solid ${theme.colors.border}`
                            }}
                        >
                            <FaCube size={48} color={theme.colors.mutedText} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                            <div style={{ color: theme.colors.secondaryText, fontSize: '1rem' }}>
                                {namedCanisterPrincipals.length === 0
                                    ? 'No named canisters yet'
                                    : 'No canisters match your filter'}
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                {namedCanisterPrincipals.length === 0
                                    ? 'Public names and nicknames for canisters will appear here once set'
                                    : 'Try adjusting your filter'}
                            </div>
                        </div>
                    )}

                    {filteredPrincipals.length > 0 && (
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '1rem',
                                marginTop: '1.5rem',
                                padding: '1rem',
                                background: theme.colors.secondaryBg,
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.border}`
                            }}
                        >
                            <button
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: currentPage === 1 ? theme.colors.tertiaryBg : `linear-gradient(135deg, ${canistersPrimary}, ${canistersSecondary})`,
                                    color: currentPage === 1 ? theme.colors.mutedText : 'white',
                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    opacity: currentPage === 1 ? 0.5 : 1
                                }}
                            >
                                <FaChevronLeft size={10} />
                                Previous
                            </button>
                            <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                Page <strong style={{ color: theme.colors.primaryText }}>{currentPage}</strong> of <strong style={{ color: theme.colors.primaryText }}>{totalPages}</strong>
                            </span>
                            <button
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: currentPage === totalPages ? theme.colors.tertiaryBg : `linear-gradient(135deg, ${canistersPrimary}, ${canistersSecondary})`,
                                    color: currentPage === totalPages ? theme.colors.mutedText : 'white',
                                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    opacity: currentPage === totalPages ? 0.5 : 1
                                }}
                            >
                                Next
                                <FaChevronRight size={10} />
                            </button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Canisters;
