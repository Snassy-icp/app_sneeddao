import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createActor, canisterId } from 'declarations/sneed_sns_forum';

const ForumContext = createContext();

export function ForumProvider({ children }) {
  const [forumActor, setForumActor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const createForumActor = useCallback((identity) => {
    try {
      const actor = createActor(canisterId, {
        agentOptions: {
          host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
          identity: identity || undefined,
        },
      });

      setForumActor(actor);
      return actor;
    } catch (err) {
      console.error('Error creating forum actor:', err);
      setError('Failed to connect to forum canister');
      return null;
    }
  }, []);

  const value = {
    forumActor,
    createForumActor,
    loading,
    error,
    setLoading,
    setError,
    canisterId,
  };

  return (
    <ForumContext.Provider value={value}>
      {children}
    </ForumContext.Provider>
  );
}

export function useForum() {
  const context = useContext(ForumContext);
  if (!context) {
    throw new Error('useForum must be used within a ForumProvider');
  }
  return context;
} 