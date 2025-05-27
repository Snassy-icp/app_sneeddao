import React, { createContext, useContext, useState, useEffect } from 'react';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';

const ForumContext = createContext();

// Forum canister ID - this should be updated when the canister is deployed
const FORUM_CANISTER_ID = 'rrkah-fqaaa-aaaah-qcwwq-cai'; // Replace with actual canister ID

// IDL interface for the forum canister
const forumIdl = ({ IDL }) => {
  const ForumId = IDL.Nat;
  const TopicId = IDL.Nat;
  const ThreadId = IDL.Nat;
  const PostId = IDL.Nat;
  const NeuronId = IDL.Nat64;
  
  const CreateForumRequest = IDL.Record({
    'title': IDL.Text,
    'description': IDL.Text,
  });
  
  const CreateTopicRequest = IDL.Record({
    'forum_id': ForumId,
    'title': IDL.Text,
    'description': IDL.Text,
  });
  
  const CreateThreadRequest = IDL.Record({
    'topic_id': TopicId,
    'title': IDL.Text,
    'content': IDL.Text,
  });
  
  const CreatePostRequest = IDL.Record({
    'thread_id': ThreadId,
    'content': IDL.Text,
    'parent_post_id': IDL.Opt(PostId),
  });
  
  const VoteRequest = IDL.Record({
    'post_id': PostId,
    'neuron_id': NeuronId,
    'vote_type': IDL.Variant({
      'upvote': IDL.Null,
      'downvote': IDL.Null,
    }),
  });
  
  const ForumResponse = IDL.Record({
    'id': ForumId,
    'title': IDL.Text,
    'description': IDL.Text,
    'created_at': IDL.Nat64,
    'created_by': IDL.Principal,
    'topic_count': IDL.Nat,
  });
  
  const TopicResponse = IDL.Record({
    'id': TopicId,
    'forum_id': ForumId,
    'title': IDL.Text,
    'description': IDL.Text,
    'created_at': IDL.Nat64,
    'created_by': IDL.Principal,
    'thread_count': IDL.Nat,
  });
  
  const ThreadResponse = IDL.Record({
    'id': ThreadId,
    'topic_id': TopicId,
    'title': IDL.Text,
    'content': IDL.Text,
    'created_at': IDL.Nat64,
    'created_by': IDL.Principal,
    'post_count': IDL.Nat,
    'upvotes': IDL.Nat,
    'downvotes': IDL.Nat,
  });
  
  const PostResponse = IDL.Record({
    'id': PostId,
    'thread_id': ThreadId,
    'content': IDL.Text,
    'created_at': IDL.Nat64,
    'created_by': IDL.Principal,
    'parent_post_id': IDL.Opt(PostId),
    'upvotes': IDL.Nat,
    'downvotes': IDL.Nat,
  });
  
  const Result = (T) => IDL.Variant({
    'ok': T,
    'err': IDL.Text,
  });
  
  const ForumStats = IDL.Record({
    'total_forums': IDL.Nat,
    'total_topics': IDL.Nat,
    'total_threads': IDL.Nat,
    'total_posts': IDL.Nat,
    'total_votes': IDL.Nat,
  });
  
  return IDL.Service({
    // Admin functions
    'create_forum': IDL.Func([CreateForumRequest], [Result(ForumResponse)], []),
    'delete_forum': IDL.Func([ForumId], [Result(IDL.Bool)], []),
    'create_topic': IDL.Func([CreateTopicRequest], [Result(TopicResponse)], []),
    'delete_topic': IDL.Func([TopicId], [Result(IDL.Bool)], []),
    'delete_thread': IDL.Func([ThreadId], [Result(IDL.Bool)], []),
    'delete_post': IDL.Func([PostId], [Result(IDL.Bool)], []),
    
    // Public functions
    'create_thread': IDL.Func([CreateThreadRequest], [Result(ThreadResponse)], []),
    'create_post': IDL.Func([CreatePostRequest], [Result(PostResponse)], []),
    'vote_on_post': IDL.Func([VoteRequest], [Result(IDL.Bool)], []),
    'retract_vote': IDL.Func([PostId, NeuronId], [Result(IDL.Bool)], []),
    
    // Query functions
    'get_forums': IDL.Func([], [IDL.Vec(ForumResponse)], ['query']),
    'get_topics_by_forum': IDL.Func([ForumId], [IDL.Vec(TopicResponse)], ['query']),
    'get_threads_by_topic': IDL.Func([TopicId], [IDL.Vec(ThreadResponse)], ['query']),
    'get_posts_by_thread': IDL.Func([ThreadId], [IDL.Vec(PostResponse)], ['query']),
    'get_forum_stats': IDL.Func([], [ForumStats], ['query']),
  });
};

export function ForumProvider({ children }) {
  const [forumActor, setForumActor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const createForumActor = (identity) => {
    try {
      const agent = new HttpAgent({
        host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
        identity,
      });

      if (process.env.DFX_NETWORK !== 'ic') {
        agent.fetchRootKey();
      }

      const actor = Actor.createActor(forumIdl, {
        agent,
        canisterId: FORUM_CANISTER_ID,
      });

      setForumActor(actor);
      return actor;
    } catch (err) {
      console.error('Error creating forum actor:', err);
      setError('Failed to connect to forum canister');
      return null;
    }
  };

  const value = {
    forumActor,
    createForumActor,
    loading,
    error,
    setLoading,
    setError,
    FORUM_CANISTER_ID,
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