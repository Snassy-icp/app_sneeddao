// /drive: Sneed Drive phase 0, notes first (spec/sneed_drive_phase0.md). Hidden: only Sneed Hub
// admins see it, and only after turning on the "Sneed Drive (beta)" switch in this browser (on
// /admin or here). The canister checks every access itself.
//
// Casual: a folder tree, the notes of a folder with their tags, a markdown editor with preview,
// search, tag filter. Behind "Advanced": search options, note details, moving, inherited grants,
// drive settings. No browser popups: confirmations are inline.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { FaFolder, FaFolderOpen, FaFileAlt, FaPlus, FaSearch, FaTrash, FaHistory, FaShareAlt, FaSave, FaUndo, FaChevronRight, FaChevronDown, FaTimes, FaTags, FaHdd, FaUsers, FaSpinner } from 'react-icons/fa';
import Header from '../components/Header';
import MarkdownBody from '../components/MarkdownBody';
import PrincipalInput from '../components/PrincipalInput';
import { Card, Button, Notice, Advanced, Pill } from '../components/convert/ConvertUi';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import {
    driveEnabled, driveId, driveActor, driveFlagOn, setDriveFlag, ROOT, unwrap, opt, isFolder, isNote, canWrite, canManage, isOwnerOf,
    fmtWhen, fmtBytes, freeNoteName, noteTitle, parseTags, listAllChildren, searchAll, listAllTags, listAllTrash, listAllShared, textContent,
    ROLES, roleLabel, errorText,
} from '../utils/DriveService';

/// The per-browser switch (admins only), shown on /admin and on /drive while it is off.
export function DriveBetaSwitch({ on, onChange }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: c.primaryText, cursor: 'pointer' }}>
            <input type="checkbox" role="switch" aria-checked={on} checked={on} onChange={(e) => { setDriveFlag(e.target.checked); onChange?.(e.target.checked); }} style={{ marginTop: 3 }} />
            <span>
                <b>Sneed Drive (beta)</b>
                <span style={{ display: 'block', fontSize: 12, color: c.mutedText }}>Admins only · in this browser only · adds Drive to the Admin menu</span>
            </span>
        </label>
    );
}

export default function Drive() {
    const { theme, isDark } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated } = useAuth();
    const { isAdmin, loading: adminLoading } = useAdminCheck({ identity, isAuthenticated, redirectPath: '/' });
    const [flag, setFlag] = useState(() => driveFlagOn());
    const actor = useMemo(() => (identity && driveEnabled ? driveActor(identity) : null), [identity]);

    const page = (body) => (
        <>
            <Header />
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.25rem 16px 3rem', boxSizing: 'border-box' }}>
                <h1 style={{ margin: '0 0 4px', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <FaHdd color={c.accent} /> Sneed Drive <Pill tone="pending">Beta</Pill>
                </h1>
                <p style={{ margin: '0 0 16px', color: c.secondaryText, fontSize: 14 }}>
                    Notes and small files in your own canister, with versions, trash, tags and sharing.{driveId && <> Canister <code>{driveId}</code>.</>}
                </p>
                {body}
            </div>
        </>
    );
    const muted = { color: c.mutedText, fontSize: 14 };
    if (adminLoading) return page(<div style={{ ...muted, padding: 30, textAlign: 'center' }}><FaSpinner /> Loading…</div>);
    if (!isAdmin) return page(<div style={{ ...muted, padding: 30, textAlign: 'center' }}>Admins only.</div>);
    if (!flag) return page(<Card><p style={{ ...muted, marginTop: 0 }}>Sneed Drive is in an early beta for admins. Turn it on to try it in this browser.</p><DriveBetaSwitch on={false} onChange={setFlag} /></Card>);
    if (!driveEnabled) return page(<Card><p style={{ ...muted, margin: 0 }}>Sneed Drive has no canister on this network yet (CANISTER_ID_SNEED_DRIVE).</p></Card>);
    if (!actor) return page(<div style={{ ...muted, padding: 30, textAlign: 'center' }}>Sign in to open your drive.</div>);
    return page(<DriveApp actor={actor} c={c} isDark={isDark} isAuthenticated={isAuthenticated} me={identity.getPrincipal()} />);
}

// ---------------------------------------------------------------------------------------------

function DriveApp({ actor, c, isDark, isAuthenticated, me }) {
    const [roots, setRoots] = useState(null); // [{ node, label }]: my drive, or what is shared with me
    const [folder, setFolder] = useState(null); // NodeInfo of the open folder
    const [items, setItems] = useState([]); // its children
    const [tree, setTree] = useState({}); // folder id (string) -> child folders, loaded on expand
    const [open, setOpen] = useState({}); // folder id -> expanded
    const [note, setNote] = useState(null); // NodeInfo of the open note
    const [view, setView] = useState('folder'); // folder | note | trash | search
    const [tags, setTags] = useState([]);
    const [tagFilter, setTagFilter] = useState(null);
    const [query, setQuery] = useState('');
    const [searchOpts, setSearchOpts] = useState({ inContent: true, includeTrash: false, here: false });
    const [results, setResults] = useState([]);
    const [notice, setNotice] = useState(null); // { tone, text }
    const [busy, setBusy] = useState(false);
    const [info, setInfo] = useState(null);

    const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 14, boxSizing: 'border-box', colorScheme: isDark ? 'dark' : 'light', minWidth: 0 };
    const select = { ...input, padding: '7px 8px' };
    const fail = (e) => setNotice({ tone: 'error', text: e?.message || String(e) });
    const run = async (f, okText) => {
        setBusy(true); setNotice(null);
        try { const r = await f(); if (okText) setNotice({ tone: 'success', text: okText }); return r; } catch (e) { fail(e); return undefined; } finally { setBusy(false); }
    };

    const loadFolder = useCallback(async (id) => {
        const [f, kids] = await Promise.all([actor.get_node(id).then(unwrap), listAllChildren(actor, id)]);
        setFolder(f);
        setItems(kids);
        setTree((t) => ({ ...t, [String(id)]: kids.filter(isFolder) }));
        return f;
    }, [actor]);

    const refreshTags = useCallback(async () => { try { setTags(await listAllTags(actor)); } catch { /* tags are optional */ } }, [actor]);

    // where to start: my drive when I own it (or have access to the root), else what is shared with me
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const rootR = await actor.get_node(ROOT);
                let rs;
                if ('ok' in rootR) rs = [{ node: rootR.ok, label: isOwnerOf(rootR.ok) ? 'My drive' : 'Drive' }];
                else rs = (await listAllShared(actor)).map((s) => ({ node: s.node, label: s.node.name, role: s.role }));
                if (!alive) return;
                setRoots(rs);
                if (rs.length) { await loadFolder(rs[0].node.id); setOpen({ [String(rs[0].node.id)]: true }); }
                if ('ok' in rootR && isOwnerOf(rootR.ok)) setInfo(await actor.get_drive_info());
                await refreshTags();
            } catch (e) { if (alive) fail(e); }
        })();
        return () => { alive = false; };
    }, [actor, loadFolder, refreshTags]);

    const expand = async (id) => {
        const k = String(id);
        setOpen((o) => ({ ...o, [k]: !o[k] }));
        if (!tree[k]) {
            try { const kids = await listAllChildren(actor, id); setTree((t) => ({ ...t, [k]: kids.filter(isFolder) })); } catch (e) { fail(e); }
        }
    };
    const openFolder = (id) => run(async () => { await loadFolder(id); setView('folder'); setNote(null); });
    const openNote = (n) => { setNote(n); setView('note'); };

    const newNote = () => run(async () => {
        const name = freeNoteName(items.map((i) => i.name));
        const n = unwrap(await actor.create_file({ parent: folder.id, name, content: { text: '' }, mime: ['text/markdown'], tags: tagFilter ? [tagFilter] : [] }));
        await loadFolder(folder.id);
        openNote(n);
    });
    const [newFolderName, setNewFolderName] = useState(null);
    const createFolder = () => run(async () => {
        unwrap(await actor.create_folder({ parent: folder.id, name: newFolderName.trim(), tags: [] }));
        setNewFolderName(null);
        await loadFolder(folder.id);
    });

    const doSearch = (e) => {
        e?.preventDefault?.();
        if (!query.trim() && !tagFilter) { setView('folder'); return; }
        run(async () => {
            const hits = await searchAll(actor, { query: query.trim(), tags: tagFilter ? [tagFilter] : [], under: searchOpts.here && folder ? folder.id : null, inContent: searchOpts.inContent, includeTrash: searchOpts.includeTrash });
            setResults(hits);
            setView('search');
        });
    };
    const pickTag = (t) => {
        const next = tagFilter === t ? null : t;
        setTagFilter(next);
        if (!next && !query.trim()) { setView('folder'); return; }
        run(async () => {
            setResults(await searchAll(actor, { query: query.trim(), tags: next ? [next] : [], inContent: searchOpts.inContent }));
            setView('search');
        });
    };

    const afterChange = async () => { if (folder) await loadFolder(folder.id); await refreshTags(); };

    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: 14, minWidth: 0, boxSizing: 'border-box' };
    const link = (active) => ({ background: active ? `${c.accent}22` : 'none', border: 'none', color: c.primaryText, cursor: 'pointer', padding: '5px 6px', borderRadius: 6, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, width: '100%', minWidth: 0 });

    const Tree = ({ node, depth }) => {
        const k = String(node.id);
        const kids = tree[k] || [];
        return (
            <div>
                <div style={{ display: 'flex', alignItems: 'center', paddingLeft: depth * 12 }}>
                    <button type="button" aria-label={open[k] ? 'Collapse' : 'Expand'} onClick={() => expand(node.id)} style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer', padding: 2, width: 18 }}>
                        {open[k] ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                    </button>
                    <button type="button" onClick={() => openFolder(node.id)} style={link(view !== 'trash' && folder?.id === node.id)}>
                        {folder?.id === node.id ? <FaFolderOpen color={c.accent} /> : <FaFolder color={c.accent} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label || node.name}</span>
                    </button>
                </div>
                {open[k] && kids.map((kid) => <Tree key={String(kid.id)} node={kid} depth={depth + 1} />)}
            </div>
        );
    };

    if (!roots) return <div style={{ color: c.mutedText, padding: 30, textAlign: 'center' }}><FaSpinner /> Opening your drive…</div>;

    return (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* sidebar */}
            <aside style={{ ...card, flex: '1 1 240px', maxWidth: '100%' }}>
                {roots.length === 0 && <p style={{ color: c.mutedText, fontSize: 14, margin: 0 }}>Nothing is shared with you on this drive yet.</p>}
                {roots.map((r) => <Tree key={String(r.node.id)} node={{ ...r.node, label: r.label }} depth={0} />)}
                {roots.length > 0 && roots[0].role && <div style={{ fontSize: 12, color: c.mutedText, marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}><FaUsers /> Shared with you</div>}
                <div style={{ borderTop: `1px solid ${c.border}`, margin: '10px 0', paddingTop: 10 }}>
                    <div style={{ fontSize: 12, color: c.mutedText, marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}><FaTags /> Tags</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {tags.length === 0 && <span style={{ fontSize: 13, color: c.mutedText }}>No tags yet</span>}
                        {tags.map((t) => (
                            <button key={t.tag} type="button" onClick={() => pickTag(t.tag)}
                                style={{ fontSize: 12, borderRadius: 999, padding: '2px 9px', cursor: 'pointer', border: `1px solid ${tagFilter === t.tag ? c.accent : c.border}`, background: tagFilter === t.tag ? `${c.accent}22` : 'transparent', color: c.primaryText }}>
                                #{t.tag} <span style={{ color: c.mutedText }}>{String(t.count)}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <button type="button" onClick={() => setView('trash')} style={link(view === 'trash')}><FaTrash color={c.mutedText} /> Trash</button>
                {info && (
                    <Advanced title="Drive details">
                        <DriveDetails actor={actor} info={info} setInfo={setInfo} c={c} input={input} run={run} />
                    </Advanced>
                )}
            </aside>

            {/* main */}
            <main style={{ flex: '3 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: '100%' }}>
                <form onSubmit={doSearch} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes, names and tags" aria-label="Search" style={{ ...input, flex: '1 1 200px' }} />
                    <Button type="submit" disabled={busy}><FaSearch /> Search</Button>
                    {(view === 'search' || tagFilter) && <Button variant="ghost" onClick={() => { setQuery(''); setTagFilter(null); setView('folder'); }}><FaTimes /> Clear</Button>}
                </form>
                <div style={{ marginTop: -8 }}>
                    <Advanced title="Search options">
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: c.primaryText }}>
                            <label><input type="checkbox" checked={searchOpts.inContent} onChange={(e) => setSearchOpts({ ...searchOpts, inContent: e.target.checked })} /> Search inside notes</label>
                            <label><input type="checkbox" checked={searchOpts.here} onChange={(e) => setSearchOpts({ ...searchOpts, here: e.target.checked })} /> Only in this folder</label>
                            <label><input type="checkbox" checked={searchOpts.includeTrash} onChange={(e) => setSearchOpts({ ...searchOpts, includeTrash: e.target.checked })} /> Include the trash</label>
                        </div>
                    </Advanced>
                </div>
                {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

                {view === 'folder' && folder && (
                    <section style={card}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                            <h2 style={{ margin: 0, fontSize: 18, color: c.primaryText, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder.id === ROOT ? 'My drive' : folder.name}</h2>
                            {canWrite(folder) && <Button onClick={newNote} disabled={busy}><FaPlus /> New note</Button>}
                            {canWrite(folder) && <Button variant="ghost" onClick={() => setNewFolderName('')} disabled={busy}><FaFolder /> New folder</Button>}
                            <FolderActions actor={actor} folder={folder} c={c} input={input} select={select} run={run} isAuthenticated={isAuthenticated} onChanged={afterChange} onGone={() => openFolder(folder.parent[0] ?? roots[0].node.id)} />
                        </div>
                        {newFolderName !== null && (
                            <form onSubmit={(e) => { e.preventDefault(); createFolder(); }} style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                                <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name" style={{ ...input, flex: '1 1 160px' }} />
                                <Button type="submit" disabled={busy || !newFolderName.trim()}>Create</Button>
                                <Button variant="ghost" onClick={() => setNewFolderName(null)}>Cancel</Button>
                            </form>
                        )}
                        {items.length === 0 && <p style={{ color: c.mutedText, fontSize: 14 }}>Empty. {canWrite(folder) ? 'Start with a new note.' : ''}</p>}
                        <ItemList items={[...items].sort((a, b) => (isFolder(b) - isFolder(a)) || Number(b.modified_at - a.modified_at))} c={c} onOpen={(n) => (isFolder(n) ? openFolder(n.id) : openNote(n))} />
                    </section>
                )}

                {view === 'search' && (
                    <section style={card}>
                        <h2 style={{ margin: '0 0 10px', fontSize: 18, color: c.primaryText }}>{results.length} found{tagFilter && <> with #{tagFilter}</>}</h2>
                        <ItemList items={results.map((h) => h.node)} snippets={Object.fromEntries(results.map((h) => [String(h.node.id), h.snippet.length ? h.snippet[0] : null]))} c={c} onOpen={(n) => (isFolder(n) ? openFolder(n.id) : openNote(n))} />
                    </section>
                )}

                {view === 'note' && note && (
                    <NoteEditor key={String(note.id)} actor={actor} initial={note} c={c} input={input} select={select} run={run} busy={busy} me={me} isAuthenticated={isAuthenticated}
                        setNotice={setNotice} onChanged={afterChange} onClose={() => { setView('folder'); setNote(null); }} />
                )}

                {view === 'trash' && <TrashView actor={actor} c={c} run={run} busy={busy} onChanged={afterChange} />}
            </main>
        </div>
    );
}

function ItemList({ items, c, onOpen, snippets = {} }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.map((n) => (
                <button key={String(n.id)} type="button" onClick={() => onOpen(n)}
                    style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', background: 'none', border: 'none', borderTop: `1px solid ${c.border}`, padding: '10px 4px', cursor: 'pointer', color: c.primaryText, minWidth: 0, width: '100%' }}>
                    <span style={{ marginTop: 3 }}>{isFolder(n) ? <FaFolder color={c.accent} /> : <FaFileAlt color={isNote(n) ? c.accent : c.mutedText} />}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isFolder(n) ? n.name : noteTitle(n.name)}{n.in_trash && <span style={{ color: c.mutedText, fontWeight: 400 }}> · in trash</span>}</span>
                        {snippets[String(n.id)] && <span style={{ display: 'block', fontSize: 13, color: c.secondaryText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippets[String(n.id)]}</span>}
                        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12, color: c.mutedText, marginTop: 2 }}>
                            <span>{fmtWhen(n.modified_at)}</span>
                            {isFolder(n) ? <span>· {String(n.children)} items</span> : <span>· {fmtBytes(n.size)}</span>}
                            {n.tags.map((t) => <span key={t} style={{ color: c.accent }}>#{t}</span>)}
                        </span>
                    </span>
                </button>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------

function NoteEditor({ actor, initial, c, input, select, run, busy, me, isAuthenticated, setNotice, onChanged, onClose }) {
    const [node, setNode] = useState(initial);
    const [text, setText] = useState(null); // editor text; null while loading
    const [saved, setSaved] = useState(''); // text of the head
    const [conflict, setConflict] = useState(false);
    const [mode, setMode] = useState('write'); // write | preview
    const [name, setName] = useState(noteTitle(initial.name));
    const [tagText, setTagText] = useState(initial.tags.join(', '));
    const [panel, setPanel] = useState(null); // history | share | null
    const [confirmTrash, setConfirmTrash] = useState(false);
    const editable = canWrite(node) && !node.in_trash;
    const dirty = text !== null && text !== saved;
    const ext = (initial.name.match(/\.[^.]+$/) || ['.md'])[0];
    const isMarkdown = node.mime === 'text/markdown' || /\.(md|markdown)$/i.test(node.name);

    const load = useCallback(async () => {
        const [n, cnt] = await Promise.all([actor.get_node(initial.id).then(unwrap), actor.get_content({ node: initial.id, version: [] }).then(unwrap)]);
        const t = textContent(cnt);
        setNode(n);
        setSaved(t ?? '');
        setText(t ?? '');
        setConflict(false);
        if (t === null) setNotice({ tone: 'warning', text: 'This file is not text; it can be read with the API only.' });
    }, [actor, initial.id, setNotice]);
    useEffect(() => { load().catch((e) => setNotice({ tone: 'error', text: e.message })); }, [load, setNotice]);

    const save = useCallback(() => run(async () => {
        const r = await actor.save_file({ node: node.id, content: { text }, mime: [], expected_head: node.head });
        if ('err' in r && 'conflict' in r.err) { setConflict(true); throw new Error(errorText(r.err)); }
        const n = unwrap(r);
        setNode(n);
        setSaved(text);
        await onChanged();
    }, 'Saved'), [actor, node, text, run, onChanged]);

    // Ctrl/Cmd+S saves
    const saveRef = useRef(save);
    saveRef.current = save;
    useEffect(() => {
        const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (editable) saveRef.current(); } };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [editable]);

    const rename = () => {
        const full = name.trim() + ext;
        if (!name.trim() || full === node.name) return;
        run(async () => { setNode(unwrap(await actor.rename(node.id, full))); await onChanged(); });
    };
    const saveTags = () => {
        const t = parseTags(tagText);
        if (t.join(',') === node.tags.join(',')) return;
        run(async () => { const n = unwrap(await actor.set_tags(node.id, t)); setNode(n); setTagText(n.tags.join(', ')); await onChanged(); });
    };
    const trash = () => run(async () => { unwrap(await actor.trash(node.id)); await onChanged(); onClose(); }, 'Moved to the trash. You can restore it from Trash.');

    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: 14, minWidth: 0, boxSizing: 'border-box' };
    const tab = (on) => ({ background: on ? `${c.accent}22` : 'transparent', border: `1px solid ${on ? c.accent : c.border}`, color: c.primaryText, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13 });

    return (
        <section style={card}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} disabled={!editable} aria-label="Title"
                    style={{ ...input, flex: '1 1 220px', fontSize: 18, fontWeight: 700, background: 'transparent', border: `1px solid transparent` }} />
                <span style={{ fontSize: 12, color: dirty ? c.warning : c.mutedText }}>{text === null ? 'Loading…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
                {editable && <Button onClick={save} disabled={busy || !dirty}><FaSave /> Save</Button>}
                <Button variant="ghost" onClick={onClose}><FaTimes /> Close</Button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <FaTags color={c.mutedText} />
                <input value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={saveTags} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} disabled={!editable} placeholder="Tags, separated by commas" aria-label="Tags" style={{ ...input, flex: '1 1 200px', fontSize: 13 }} />
            </div>
            {conflict && (
                <Notice tone="warning" style={{ marginBottom: 10 }}>
                    Someone saved this note while you were editing. <Button variant="ghost" onClick={() => run(load)} style={{ padding: '4px 10px', marginLeft: 6 }}>Load theirs (drops your edits)</Button>
                    <Button variant="ghost" onClick={() => run(async () => { const r = unwrap(await actor.save_file({ node: node.id, content: { text }, mime: [], expected_head: [] })); setNode(r); setSaved(text); setConflict(false); await onChanged(); }, 'Saved over it (theirs stays in the history)')} style={{ padding: '4px 10px', marginLeft: 6 }}>Save mine anyway</Button>
                </Notice>
            )}
            {isMarkdown && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <button type="button" style={tab(mode === 'write')} onClick={() => setMode('write')}>Write</button>
                    <button type="button" style={tab(mode === 'preview')} onClick={() => setMode('preview')}>Preview</button>
                </div>
            )}
            {text !== null && (mode === 'write' || !isMarkdown) && (
                <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable} aria-label="Note text" spellCheck
                    style={{ ...input, width: '100%', minHeight: 360, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14, lineHeight: 1.5, resize: 'vertical' }} />
            )}
            {text !== null && mode === 'preview' && isMarkdown && (
                <div style={{ border: `1px solid ${c.border}`, borderRadius: 8, padding: 12, minHeight: 360, background: c.secondaryBg, overflowWrap: 'anywhere' }}>
                    {text.trim() ? <MarkdownBody text={text} /> : <span style={{ color: c.mutedText }}>Nothing to preview</span>}
                </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                <Button variant="ghost" onClick={() => setPanel(panel === 'history' ? null : 'history')}><FaHistory /> History ({String(node.versions)})</Button>
                {canManage(node) && <Button variant="ghost" onClick={() => setPanel(panel === 'share' ? null : 'share')}><FaShareAlt /> Share</Button>}
                {editable && !confirmTrash && <Button variant="ghost" onClick={() => setConfirmTrash(true)}><FaTrash /> Move to trash</Button>}
                {confirmTrash && <><span style={{ fontSize: 13, color: c.primaryText }}>Move this note to the trash?</span><Button variant="danger" onClick={trash} disabled={busy}>Yes, move it</Button><Button variant="ghost" onClick={() => setConfirmTrash(false)}>No</Button></>}
            </div>
            {panel === 'history' && <History actor={actor} node={node} c={c} run={run} busy={busy} editable={editable} onRestored={async () => { await load(); await onChanged(); }} />}
            {panel === 'share' && <SharePanel actor={actor} node={node} c={c} input={input} select={select} run={run} busy={busy} isAuthenticated={isAuthenticated} me={me} />}
            <Advanced title="Details">
                <div style={{ fontSize: 13, color: c.secondaryText, display: 'grid', gap: 4 }}>
                    <div>File: <code>{node.name}</code> · {node.mime} · {fmtBytes(node.size)} · node {String(node.id)} · version {node.head.length ? String(node.head[0]) : '–'}</div>
                    <div>Created {fmtWhen(node.created_at)} by <PrincipalDisplay principal={node.created_by} short isAuthenticated={isAuthenticated} /></div>
                    <div>Changed {fmtWhen(node.modified_at)} by <PrincipalDisplay principal={node.modified_by} short isAuthenticated={isAuthenticated} /></div>
                    <div>Your access: {Object.keys(node.my_access)[0]} · stored in plain text (encryption comes in a later phase)</div>
                </div>
                {editable && <MoveTo actor={actor} node={node} c={c} select={select} run={run} onMoved={async (n) => { setNode(n); await onChanged(); }} />}
            </Advanced>
        </section>
    );
}

function History({ actor, node, c, run, busy, editable, onRestored }) {
    const [versions, setVersions] = useState(null);
    const [next, setNext] = useState([]);
    const [shown, setShown] = useState(null); // { id, text }
    const load = useCallback(async (before = []) => {
        const p = unwrap(await actor.list_versions({ node: node.id, before, limit: 20n }));
        setVersions((v) => (before.length ? [...(v || []), ...p.items] : p.items));
        setNext(p.next);
    }, [actor, node.id]);
    useEffect(() => { load().catch(() => setVersions([])); }, [load, node.head]);
    const show = (v) => run(async () => { const cnt = unwrap(await actor.get_content({ node: node.id, version: [v.id] })); setShown({ id: v.id, text: textContent(cnt) ?? '(not text)' }); });
    return (
        <div style={{ marginTop: 12, borderTop: `1px solid ${c.border}`, paddingTop: 10 }}>
            {!versions && <span style={{ color: c.mutedText, fontSize: 13 }}><FaSpinner /> Loading versions…</span>}
            {versions?.map((v) => (
                <div key={String(v.id)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: c.primaryText, padding: '4px 0' }}>
                    <button type="button" onClick={() => show(v)} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', padding: 0, fontSize: 13 }}>{fmtWhen(v.created_at)}</button>
                    <span style={{ color: c.mutedText }}>{fmtBytes(v.size)}</span>
                    {v.is_head && <Pill tone="success">current</Pill>}
                </div>
            ))}
            {next.length > 0 && <Button variant="ghost" onClick={() => run(() => load(next))} style={{ padding: '4px 10px', marginTop: 6 }}>Older versions</Button>}
            {shown && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: c.secondaryText }}>Version {String(shown.id)}</span>
                        {editable && node.head[0] !== shown.id && <Button onClick={() => run(async () => { unwrap(await actor.restore_version(node.id, shown.id)); setShown(null); await onRestored(); }, 'Restored as the newest version')} disabled={busy} style={{ padding: '4px 10px' }}><FaUndo /> Restore this version</Button>}
                        <Button variant="ghost" onClick={() => setShown(null)} style={{ padding: '4px 10px' }}><FaTimes /></Button>
                    </div>
                    <div style={{ border: `1px solid ${c.border}`, borderRadius: 8, padding: 10, background: c.secondaryBg, maxHeight: 320, overflow: 'auto' }}><MarkdownBody text={shown.text} /></div>
                </div>
            )}
        </div>
    );
}

function SharePanel({ actor, node, c, input, select, run, busy, isAuthenticated, me }) {
    const [g, setG] = useState(null);
    const [who, setWho] = useState('');
    const [role, setRole] = useState('read');
    const load = useCallback(async () => setG(unwrap(await actor.get_grants(node.id))), [actor, node.id]);
    useEffect(() => { load().catch(() => setG({ direct: [], inherited: [] })); }, [load]);
    const add = () => run(async () => {
        let p;
        try { p = Principal.fromText(who.trim()); } catch { throw new Error('That is not a principal'); }
        setG(unwrap(await actor.grant({ node: node.id, principal: p, role: { [role]: null } })));
        setWho('');
    }, 'Shared');
    const change = (p, r) => run(async () => setG(unwrap(await actor.grant({ node: node.id, principal: p, role: { [r]: null } }))));
    const remove = (p) => run(async () => setG(unwrap(await actor.revoke({ node: node.id, principal: p }))), 'Access removed');
    return (
        <div style={{ marginTop: 12, borderTop: `1px solid ${c.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: c.secondaryText }}>People you share with can open this {isFolder(node) ? 'folder and everything in it' : 'note'}. Sharing is recorded on-chain with their principal.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}><PrincipalInput value={who} onChange={setWho} isAuthenticated={isAuthenticated} placeholder="Principal or name" /></div>
                <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" style={select}>
                    {ROLES.map((r) => <option key={r.key} value={r.key} style={{ background: c.secondaryBg, color: c.primaryText }}>{r.label}</option>)}
                </select>
                <Button onClick={add} disabled={busy || !who.trim()}><FaShareAlt /> Share</Button>
            </div>
            {!g && <span style={{ color: c.mutedText, fontSize: 13 }}><FaSpinner /> Loading…</span>}
            {g?.direct.length === 0 && <span style={{ color: c.mutedText, fontSize: 13 }}>Not shared here.</span>}
            {g?.direct.map((x) => (
                <div key={x.principal.toText()} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                    <span style={{ flex: '1 1 200px', minWidth: 0 }}><PrincipalDisplay principal={x.principal} short isAuthenticated={isAuthenticated} /></span>
                    <select value={Object.keys(x.role)[0]} onChange={(e) => change(x.principal, e.target.value)} aria-label="Role" style={select} disabled={busy}>
                        {ROLES.map((r) => <option key={r.key} value={r.key} style={{ background: c.secondaryBg, color: c.primaryText }}>{r.label}</option>)}
                    </select>
                    <Button variant="ghost" onClick={() => remove(x.principal)} disabled={busy} style={{ padding: '4px 10px' }}><FaTimes /> Remove</Button>
                </div>
            ))}
            {g && g.inherited.length > 0 && (
                <Advanced title={`Access from folders above (${g.inherited.length})`}>
                    {g.inherited.map((x) => (
                        <div key={`${x.node}-${x.principal.toText()}`} style={{ fontSize: 13, color: c.secondaryText, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <PrincipalDisplay principal={x.principal} short isAuthenticated={isAuthenticated} /> · {roleLabel(x.role)} · from folder {String(x.node)}
                        </div>
                    ))}
                </Advanced>
            )}
        </div>
    );
}

function MoveTo({ actor, node, c, select, run, onMoved }) {
    const [folders, setFolders] = useState(null);
    const [target, setTarget] = useState('');
    const load = () => run(async () => {
        const hits = await searchAll(actor, { kind: 'folder', inContent: false }, 500);
        const list = hits.map((h) => h.node).filter((f) => canWrite(f) && f.id !== node.id && f.id !== node.parent[0]);
        try { const root = unwrap(await actor.get_node(ROOT)); if (canWrite(root) && node.parent[0] !== ROOT) list.unshift(root); } catch { /* no access to the root */ }
        setFolders(list);
    });
    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            {!folders && <Button variant="ghost" onClick={load} style={{ padding: '4px 10px' }}>Move to another folder…</Button>}
            {folders && (
                <>
                    <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Folder" style={select}>
                        <option value="" style={{ background: c.secondaryBg, color: c.primaryText }}>Choose a folder</option>
                        {folders.map((f) => <option key={String(f.id)} value={String(f.id)} style={{ background: c.secondaryBg, color: c.primaryText }}>{f.id === ROOT ? 'My drive' : f.name}</option>)}
                    </select>
                    <Button onClick={() => run(async () => { onMoved(unwrap(await actor.move_node(node.id, BigInt(target)))); setFolders(null); }, 'Moved')} disabled={!target} style={{ padding: '4px 10px' }}>Move</Button>
                </>
            )}
        </div>
    );
}

function FolderActions({ actor, folder, c, input, select, run, isAuthenticated, onChanged, onGone }) {
    const [panel, setPanel] = useState(null); // share | rename | trash
    const [name, setName] = useState(folder.name);
    useEffect(() => { setName(folder.name); setPanel(null); }, [folder.id, folder.name]);
    if (folder.id === ROOT && !canManage(folder)) return null;
    return (
        <>
            {canManage(folder) && <Button variant="ghost" onClick={() => setPanel(panel === 'share' ? null : 'share')}><FaShareAlt /> Share</Button>}
            {folder.id !== ROOT && canWrite(folder) && <Button variant="ghost" onClick={() => setPanel(panel === 'more' ? null : 'more')}>More</Button>}
            {panel && (
                <div style={{ flexBasis: '100%' }}>
                    {panel === 'share' && <SharePanel actor={actor} node={folder} c={c} input={input} select={select} run={run} busy={false} isAuthenticated={isAuthenticated} />}
                    {panel === 'more' && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Folder name" style={{ ...input, flex: '1 1 160px' }} />
                            <Button variant="ghost" onClick={() => run(async () => { unwrap(await actor.rename(folder.id, name.trim())); await onChanged(); }, 'Renamed')} disabled={!name.trim() || name === folder.name}>Rename</Button>
                            <Button variant="danger" onClick={() => setPanel('trash')}><FaTrash /> Move folder to trash</Button>
                        </div>
                    )}
                    {panel === 'trash' && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center', fontSize: 13, color: c.primaryText }}>
                            Move “{folder.name}” and everything in it to the trash?
                            <Button variant="danger" onClick={() => run(async () => { unwrap(await actor.trash(folder.id)); onGone(); }, 'Moved to the trash')}>Yes, move it</Button>
                            <Button variant="ghost" onClick={() => setPanel(null)}>No</Button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

function TrashView({ actor, c, run, busy, onChanged }) {
    const [items, setItems] = useState(null);
    const [confirm, setConfirm] = useState(null); // node id (string) | 'all'
    const [owner, setOwner] = useState(false);
    const load = useCallback(async () => {
        setItems(await listAllTrash(actor));
        try { setOwner(isOwnerOf(unwrap(await actor.get_node(ROOT)))); } catch { setOwner(false); }
    }, [actor]);
    useEffect(() => { load().catch(() => setItems([])); }, [load]);
    const purgeAll = async (f) => { let r; do { r = unwrap(await f()); } while (!r.done); };
    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: 14, minWidth: 0, boxSizing: 'border-box' };
    return (
        <section style={card}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 18, color: c.primaryText, flex: 1 }}>Trash</h2>
                {owner && items?.length > 0 && confirm !== 'all' && <Button variant="ghost" onClick={() => setConfirm('all')}>Empty trash</Button>}
                {confirm === 'all' && <><span style={{ fontSize: 13, color: c.primaryText }}>Delete everything in the trash for good?</span><Button variant="danger" disabled={busy} onClick={() => run(async () => { await purgeAll(() => actor.empty_trash()); setConfirm(null); await load(); await onChanged(); }, 'Trash emptied')}>Yes, delete</Button><Button variant="ghost" onClick={() => setConfirm(null)}>No</Button></>}
            </div>
            <p style={{ fontSize: 13, color: c.mutedText, marginTop: 0 }}>Deleted items stay here until {owner ? 'you delete them for good' : 'the drive owner deletes them'}. Restoring puts an item back where it was.</p>
            {!items && <span style={{ color: c.mutedText, fontSize: 13 }}><FaSpinner /> Loading…</span>}
            {items?.length === 0 && <p style={{ color: c.mutedText, fontSize: 14 }}>The trash is empty.</p>}
            {items?.map((n) => (
                <div key={String(n.id)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${c.border}`, padding: '8px 0', fontSize: 14, color: c.primaryText }}>
                    {isFolder(n) ? <FaFolder color={c.mutedText} /> : <FaFileAlt color={c.mutedText} />}
                    <span style={{ flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}<span style={{ display: 'block', fontSize: 12, color: c.mutedText }}>deleted {n.trashed.length ? fmtWhen(n.trashed[0].at) : ''}</span></span>
                    {canWrite(n) && <Button variant="ghost" disabled={busy} onClick={() => run(async () => { unwrap(await actor.restore(n.id)); await load(); await onChanged(); }, 'Restored')} style={{ padding: '4px 10px' }}><FaUndo /> Restore</Button>}
                    {owner && confirm !== String(n.id) && <Button variant="ghost" onClick={() => setConfirm(String(n.id))} style={{ padding: '4px 10px' }}>Delete for good</Button>}
                    {confirm === String(n.id) && <><Button variant="danger" disabled={busy} onClick={() => run(async () => { await purgeAll(() => actor.purge(n.id)); setConfirm(null); await load(); await onChanged(); }, 'Deleted for good')} style={{ padding: '4px 10px' }}>Yes, delete</Button><Button variant="ghost" onClick={() => setConfirm(null)} style={{ padding: '4px 10px' }}>No</Button></>}
                </div>
            ))}
        </section>
    );
}

function DriveDetails({ actor, info, setInfo, c, input, run }) {
    const [keep, setKeep] = useState(String(info.settings.retention.keep_versions));
    const [days, setDays] = useState(String(info.settings.retention.trash_days));
    const num = (s) => (/^\d+$/.test(s.trim()) ? BigInt(s.trim()) : null);
    return (
        <div style={{ fontSize: 13, color: c.secondaryText, display: 'grid', gap: 6 }}>
            <div>{String(info.files)} files · {String(info.folders)} folders · {String(info.versions)} versions · {fmtBytes(info.total_bytes)} of {fmtBytes(info.settings.max_total_bytes)}</div>
            <div>{String(info.trash_roots)} in trash · {String(info.grants)} shares · version {info.version}</div>
            <div style={{ display: 'grid', gap: 6 }}>
                <label>Keep the newest versions per note (0 = all, up to {String(info.settings.max_versions_per_node)})
                    <input value={keep} onChange={(e) => setKeep(e.target.value)} inputMode="numeric" style={{ ...input, width: '100%', marginTop: 4 }} /></label>
                <label>Delete trash for good after days (0 = never)
                    <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" style={{ ...input, width: '100%', marginTop: 4 }} /></label>
                <Button variant="ghost" disabled={num(keep) === null || num(days) === null} onClick={() => run(async () => {
                    unwrap(await actor.set_settings({ max_nodes: [], max_versions_per_node: [], max_total_bytes: [], retention: opt({ keep_versions: num(keep), trash_days: num(days) }) }));
                    setInfo(await actor.get_drive_info());
                }, 'Retention saved')}>Save retention</Button>
            </div>
        </div>
    );
}
