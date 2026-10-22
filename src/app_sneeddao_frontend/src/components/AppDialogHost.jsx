// Renders the requests made through utils/appDialog.js (appAlert / appConfirm / appPrompt), one at
// a time, with the app's ConfirmDialog. Mounted once in App.jsx.
import React, { useEffect, useReducer, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { useTheme } from '../contexts/ThemeContext';
import { subscribeAppDialogs, peekAppDialog, settleAppDialog } from '../utils/appDialog';

export default function AppDialogHost() {
    const { theme } = useTheme();
    const [, rerender] = useReducer((x) => x + 1, 0);
    const [value, setValue] = useState('');
    const confirmed = useRef(false);
    const req = peekAppDialog();

    useEffect(() => subscribeAppDialogs(rerender), []);
    useEffect(() => { confirmed.current = false; if (req?.kind === 'prompt') setValue(req.defaultValue || ''); }, [req]);

    if (!req) return null;

    const close = () => {
        const ok = confirmed.current;
        confirmed.current = false;
        settleAppDialog(req.kind === 'alert' ? undefined : req.kind === 'confirm' ? ok : (ok ? value : null));
    };

    const message = req.kind === 'prompt' ? (
        <div>
            <div style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{req.message}</div>
            <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { confirmed.current = true; close(); } }}
                style={{
                    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
                    border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg,
                    color: theme.colors.primaryText, fontSize: '0.9rem',
                }}
            />
        </div>
    ) : <div style={{ whiteSpace: 'pre-wrap' }}>{req.message}</div>;

    return (
        <ConfirmDialog
            isOpen
            onClose={close}
            onConfirm={() => { confirmed.current = true; }}
            title={req.title || (req.kind === 'alert' ? (req.type === 'error' ? 'Something went wrong' : req.type === 'success' ? 'Done' : 'Notice') : req.kind === 'prompt' ? 'Enter a value' : 'Please confirm')}
            message={message}
            type={req.type || (req.kind === 'alert' ? 'info' : 'warning')}
            confirmText={req.confirmText || (req.kind === 'alert' ? 'OK' : 'Confirm')}
            cancelText={req.cancelText || 'Cancel'}
            confirmVariant={req.confirmVariant || 'primary'}
            showCancel={req.kind !== 'alert'}
        />
    );
}
