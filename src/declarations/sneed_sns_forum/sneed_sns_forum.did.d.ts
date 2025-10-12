import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface AdminInfo {
  'principal' : Principal,
  'added_at' : bigint,
  'added_by' : number,
}
export interface CreateForumInput {
  'sns_root_canister_id' : [] | [Principal],
  'title' : string,
  'description' : string,
}
export interface CreatePollInput {
  'title' : string,
  'post_id' : [] | [bigint],
  'end_timestamp' : bigint,
  'body' : string,
  'vp_power' : [] | [number],
  'allow_vote_changes' : [] | [boolean],
  'thread_id' : bigint,
  'options' : Array<CreatePollOptionInput>,
}
export interface CreatePollOptionInput {
  'title' : string,
  'body' : [] | [string],
}
export interface CreateProposalThreadInput {
  'sns_root_canister_id' : Principal,
  'proposal_id' : bigint,
}
export interface CreateSpecialTopicInput {
  'sns_root_canister_id' : Principal,
  'special_topic_type' : SpecialTopicType,
}
export interface CreateThreadInput {
  'title' : [] | [string],
  'body' : string,
  'topic_id' : bigint,
}
export interface CreateTopicInput {
  'forum_id' : bigint,
  'title' : string,
  'parent_topic_id' : [] | [bigint],
  'description' : string,
}
export interface FeedFilter {
  'creator_principals' : [] | [Array<Principal>],
  'topic_ids' : [] | [Array<bigint>],
  'search_text' : [] | [string],
  'sns_root_canister_ids' : [] | [Array<Principal>],
}
export interface FeedItem {
  'id' : bigint,
  'poll_id' : [] | [bigint],
  'sns_root_canister_id' : [] | [Principal],
  'forum_id' : [] | [bigint],
  'title' : [] | [string],
  'body' : [] | [string],
  'created_at' : bigint,
  'created_by' : Principal,
  'item_type' : FeedItemType,
  'topic_id' : [] | [bigint],
  'forum_title' : [] | [string],
  'topic_title' : [] | [string],
  'thread_id' : [] | [bigint],
  'thread_title' : [] | [string],
  'replied_to_post' : [] | [
    { 'id' : bigint, 'title' : [] | [string], 'body' : string }
  ],
}
export type FeedItemType = { 'forum' : null } |
  { 'topic' : null } |
  { 'post' : null } |
  { 'thread' : null };
export type ForumError = { 'InvalidInput' : string } |
  { 'NotFound' : string } |
  { 'Unauthorized' : string } |
  { 'AlreadyExists' : string } |
  { 'InternalError' : string };
export interface ForumResponse {
  'id' : bigint,
  'sns_root_canister_id' : [] | [Principal],
  'title' : string,
  'updated_at' : bigint,
  'updated_by' : Principal,
  'deleted' : boolean,
  'description' : string,
  'created_at' : bigint,
  'created_by' : Principal,
}
export interface ForumStats {
  'total_forums' : bigint,
  'total_posts' : bigint,
  'total_votes' : bigint,
  'total_topics' : bigint,
  'total_threads' : bigint,
}
export interface GetFeedInput {
  'start_id' : [] | [bigint],
  'filter' : [] | [FeedFilter],
  'length' : bigint,
}
export interface GetFeedResponse {
  'items' : Array<FeedItem>,
  'has_more' : boolean,
  'next_start_id' : [] | [bigint],
}
export interface GetLastReadPostRequest { 'thread_id' : bigint }
export interface GetLastReadPostResponse { 'last_read_post_id' : [] | [bigint] }
export interface GetThreadsByActivityResponse {
  'threads' : Array<ThreadResponse>,
  'next_start_from' : [] | [bigint],
  'has_more' : boolean,
}
export interface NeuronId { 'id' : Uint8Array | number[] }
export interface NeuronVote {
  'updated_at' : bigint,
  'vote_type' : VoteType,
  'created_at' : bigint,
  'voting_power' : bigint,
  'neuron_id' : NeuronId,
}
export interface PollOptionResponse {
  'id' : bigint,
  'title' : string,
  'body' : [] | [string],
  'vote_count' : bigint,
  'total_voting_power' : bigint,
}
export interface PollResponse {
  'id' : bigint,
  'title' : string,
  'updated_at' : bigint,
  'updated_by' : Principal,
  'deleted' : boolean,
  'post_id' : [] | [bigint],
  'end_timestamp' : bigint,
  'body' : string,
  'vp_power' : number,
  'created_at' : bigint,
  'created_by' : Principal,
  'has_ended' : boolean,
  'allow_vote_changes' : boolean,
  'thread_id' : bigint,
  'options' : Array<PollOptionResponse>,
}
export interface PollVoteResponse {
  'poll_id' : bigint,
  'updated_at' : bigint,
  'created_at' : bigint,
  'voter_principal' : Principal,
  'option_id' : bigint,
  'voting_power' : bigint,
  'neuron_id' : NeuronId,
}
export interface PostResponse {
  'id' : bigint,
  'title' : [] | [string],
  'updated_at' : bigint,
  'updated_by' : Principal,
  'deleted' : boolean,
  'downvote_score' : bigint,
  'body' : string,
  'upvote_score' : bigint,
  'created_at' : bigint,
  'created_by' : Principal,
  'thread_id' : bigint,
  'reply_to_post_id' : [] | [bigint],
}
export interface ProposalThreadMappingResponse {
  'sns_root_canister_id' : Principal,
  'created_at' : bigint,
  'created_by' : Principal,
  'proposal_id' : bigint,
  'thread_id' : bigint,
}
export interface ProposalTopicMappingResponse {
  'proposals_topic_id' : bigint,
  'forum_id' : bigint,
  'set_at' : bigint,
  'set_by' : Principal,
}
export type Result = { 'ok' : null } |
  { 'err' : ForumError };
export type Result_1 = { 'ok' : bigint } |
  { 'err' : ForumError };
export interface SetLastReadPostRequest {
  'last_read_post_id' : bigint,
  'thread_id' : bigint,
}
export interface SetLastReadPostResponse {
  'message' : string,
  'success' : boolean,
}
export interface SetProposalTopicInput {
  'forum_id' : bigint,
  'topic_id' : bigint,
}
export type SpecialTopicType = { 'General' : null } |
  { 'Preproposals' : null } |
  { 'Governance' : null };
export interface TextLimits {
  'thread_body_max_length' : bigint,
  'forum_description_max_length' : bigint,
  'thread_title_max_length' : bigint,
  'topic_title_max_length' : bigint,
  'forum_title_max_length' : bigint,
  'post_title_max_length' : bigint,
  'topic_description_max_length' : bigint,
  'post_body_max_length' : bigint,
}
export interface ThreadContextResponse {
  'sns_root_canister_id' : [] | [Principal],
  'forum_id' : bigint,
  'topic_id' : bigint,
  'thread_id' : bigint,
}
export interface ThreadResponse {
  'id' : bigint,
  'title' : [] | [string],
  'updated_at' : bigint,
  'updated_by' : Principal,
  'deleted' : boolean,
  'total_posts_count' : [] | [bigint],
  'body' : string,
  'created_at' : bigint,
  'created_by' : Principal,
  'topic_id' : bigint,
  'unread_posts_count' : [] | [bigint],
}
export interface ThreadVoteResponse {
  'post_id' : bigint,
  'neuron_votes' : Array<NeuronVote>,
}
export interface TipResponse {
  'id' : bigint,
  'post_id' : bigint,
  'to_principal' : Principal,
  'created_at' : bigint,
  'created_by' : Principal,
  'from_principal' : Principal,
  'token_ledger_principal' : Principal,
  'transaction_block_index' : [] | [bigint],
  'thread_id' : bigint,
  'amount' : bigint,
}
export interface TipStats {
  'total_tips' : bigint,
  'total_tip_amount_by_token' : Array<[Principal, bigint]>,
}
export interface TipTokenSummary {
  'total_amount' : bigint,
  'token_ledger_principal' : Principal,
  'tip_count' : bigint,
}
export interface TopicResponse {
  'id' : bigint,
  'forum_id' : bigint,
  'title' : string,
  'updated_at' : bigint,
  'updated_by' : Principal,
  'deleted' : boolean,
  'parent_topic_id' : [] | [bigint],
  'description' : string,
  'created_at' : bigint,
  'created_by' : Principal,
}
export interface TopicStatistics {
  'thread_count' : bigint,
  'topic_id' : bigint,
  'total_unread_posts' : bigint,
}
export interface UpdateTextLimitsInput {
  'thread_body_max_length' : [] | [bigint],
  'forum_description_max_length' : [] | [bigint],
  'thread_title_max_length' : [] | [bigint],
  'topic_title_max_length' : [] | [bigint],
  'forum_title_max_length' : [] | [bigint],
  'post_title_max_length' : [] | [bigint],
  'topic_description_max_length' : [] | [bigint],
  'post_body_max_length' : [] | [bigint],
}
export interface VoteResponse {
  'updated_at' : bigint,
  'post_id' : bigint,
  'vote_type' : VoteType,
  'created_at' : bigint,
  'voter_principal' : Principal,
  'voting_power' : bigint,
  'neuron_id' : NeuronId,
}
export type VoteType = { 'upvote' : null } |
  { 'downvote' : null };
export interface _SERVICE {
  'add_admin' : ActorMethod<[Principal], Result>,
  'create_forum' : ActorMethod<[CreateForumInput], Result_1>,
  'create_poll' : ActorMethod<[CreatePollInput], Result_1>,
  'create_post' : ActorMethod<
    [bigint, [] | [bigint], [] | [string], string],
    Result_1
  >,
  'create_proposal_thread' : ActorMethod<[CreateProposalThreadInput], Result_1>,
  'create_proposal_thread_with_auto_setup' : ActorMethod<
    [CreateProposalThreadInput],
    Result_1
  >,
  'create_sns_forum_setup' : ActorMethod<[Principal], Result_1>,
  'create_special_topic' : ActorMethod<[CreateSpecialTopicInput], Result_1>,
  'create_thread' : ActorMethod<[CreateThreadInput], Result_1>,
  'create_tip' : ActorMethod<
    [Principal, bigint, Principal, bigint, [] | [bigint]],
    Result_1
  >,
  'create_topic' : ActorMethod<[CreateTopicInput], Result_1>,
  'delete_forum' : ActorMethod<[bigint], Result>,
  'delete_post' : ActorMethod<[bigint], Result>,
  'delete_thread' : ActorMethod<[bigint], Result>,
  'delete_topic' : ActorMethod<[bigint], Result>,
  'get_admins' : ActorMethod<[], Array<AdminInfo>>,
  'get_current_counter' : ActorMethod<[], bigint>,
  'get_feed' : ActorMethod<[GetFeedInput], GetFeedResponse>,
  'get_forum' : ActorMethod<[bigint], [] | [ForumResponse]>,
  'get_forum_admin' : ActorMethod<[bigint], [] | [ForumResponse]>,
  'get_forum_by_sns_root' : ActorMethod<[Principal], [] | [ForumResponse]>,
  'get_forums' : ActorMethod<[], Array<ForumResponse>>,
  'get_forums_admin' : ActorMethod<[], Array<ForumResponse>>,
  'get_last_read_post' : ActorMethod<
    [GetLastReadPostRequest],
    GetLastReadPostResponse
  >,
  'get_last_seen_replies_timestamp' : ActorMethod<[Principal], [] | [bigint]>,
  'get_last_seen_tip_timestamp' : ActorMethod<[Principal], [] | [bigint]>,
  'get_poll' : ActorMethod<[bigint], [] | [PollResponse]>,
  'get_poll_votes' : ActorMethod<[bigint], Array<PollVoteResponse>>,
  'get_polls_by_post' : ActorMethod<[bigint], Array<PollResponse>>,
  'get_polls_by_thread' : ActorMethod<[bigint], Array<PollResponse>>,
  'get_post' : ActorMethod<[bigint], [] | [PostResponse]>,
  'get_post_admin' : ActorMethod<[bigint], [] | [PostResponse]>,
  'get_post_replies' : ActorMethod<[bigint], Array<PostResponse>>,
  'get_post_replies_admin' : ActorMethod<[bigint], Array<PostResponse>>,
  'get_post_votes' : ActorMethod<[bigint], Array<VoteResponse>>,
  'get_post_votes_for_neurons' : ActorMethod<
    [bigint, Array<NeuronId>],
    [] | [ThreadVoteResponse]
  >,
  'get_posts_by_thread' : ActorMethod<[bigint], Array<PostResponse>>,
  'get_posts_by_thread_admin' : ActorMethod<[bigint], Array<PostResponse>>,
  'get_posts_by_user' : ActorMethod<[Principal], Array<PostResponse>>,
  'get_proposal_thread' : ActorMethod<
    [Principal, bigint],
    [] | [ProposalThreadMappingResponse]
  >,
  'get_proposals_topic' : ActorMethod<
    [bigint],
    [] | [ProposalTopicMappingResponse]
  >,
  'get_proposals_topic_by_sns_root' : ActorMethod<
    [Principal],
    [] | [ProposalTopicMappingResponse]
  >,
  'get_recent_replies_count' : ActorMethod<[Principal], bigint>,
  'get_recent_tips_count' : ActorMethod<[Principal], bigint>,
  'get_recent_tips_received' : ActorMethod<[Principal], Array<TipResponse>>,
  'get_replies_to_user' : ActorMethod<[Principal], Array<PostResponse>>,
  'get_stats' : ActorMethod<[], ForumStats>,
  'get_subtopics' : ActorMethod<[bigint], Array<TopicResponse>>,
  'get_text_limits' : ActorMethod<[], TextLimits>,
  'get_thread' : ActorMethod<[bigint], [] | [ThreadResponse]>,
  'get_thread_admin' : ActorMethod<[bigint], [] | [ThreadResponse]>,
  'get_thread_context' : ActorMethod<[bigint], [] | [ThreadContextResponse]>,
  'get_thread_proposal_id' : ActorMethod<[bigint], [] | [[number, bigint]]>,
  'get_thread_votes_for_neurons' : ActorMethod<
    [bigint, Array<NeuronId>],
    Array<ThreadVoteResponse>
  >,
  'get_threads_by_activity' : ActorMethod<
    [bigint, [] | [bigint], bigint, boolean],
    GetThreadsByActivityResponse
  >,
  'get_threads_by_activity_with_unread_counts' : ActorMethod<
    [bigint, [] | [bigint], bigint, boolean],
    GetThreadsByActivityResponse
  >,
  'get_threads_by_topic' : ActorMethod<[bigint], Array<ThreadResponse>>,
  'get_threads_by_topic_admin' : ActorMethod<[bigint], Array<ThreadResponse>>,
  'get_threads_by_topic_with_unread_counts' : ActorMethod<
    [bigint],
    Array<ThreadResponse>
  >,
  'get_threads_by_user' : ActorMethod<[Principal], Array<ThreadResponse>>,
  'get_tip' : ActorMethod<[bigint], [] | [TipResponse]>,
  'get_tip_stats' : ActorMethod<[], TipStats>,
  'get_tip_tokens_received_by_user' : ActorMethod<
    [Principal],
    Array<TipTokenSummary>
  >,
  'get_tips_by_post' : ActorMethod<[bigint], Array<TipResponse>>,
  'get_tips_by_thread' : ActorMethod<[bigint], Array<TipResponse>>,
  'get_tips_given_by_user' : ActorMethod<[Principal], Array<TipResponse>>,
  'get_tips_received_by_user' : ActorMethod<[Principal], Array<TipResponse>>,
  'get_tips_received_since' : ActorMethod<
    [Principal, bigint],
    Array<TipResponse>
  >,
  'get_topic' : ActorMethod<[bigint], [] | [TopicResponse]>,
  'get_topic_admin' : ActorMethod<[bigint], [] | [TopicResponse]>,
  'get_topic_statistics' : ActorMethod<[bigint], TopicStatistics>,
  'get_topics_by_forum' : ActorMethod<[bigint], Array<TopicResponse>>,
  'get_topics_by_forum_admin' : ActorMethod<[bigint], Array<TopicResponse>>,
  'get_user_thread_reads_for_topic' : ActorMethod<
    [bigint],
    Array<[bigint, bigint]>
  >,
  'health_check' : ActorMethod<[], boolean>,
  'is_admin' : ActorMethod<[Principal], boolean>,
  'mark_replies_seen_up_to' : ActorMethod<[bigint], undefined>,
  'mark_tips_seen_up_to' : ActorMethod<[bigint], undefined>,
  'remove_admin' : ActorMethod<[Principal], Result>,
  'remove_proposals_topic' : ActorMethod<[bigint], Result>,
  'retract_vote' : ActorMethod<[bigint], Result>,
  'retract_vote_with_neurons' : ActorMethod<[bigint, Array<NeuronId>], Result>,
  'set_last_read_post' : ActorMethod<
    [SetLastReadPostRequest],
    SetLastReadPostResponse
  >,
  'set_proposals_topic' : ActorMethod<[SetProposalTopicInput], Result>,
  'undelete_forum' : ActorMethod<[bigint], Result>,
  'undelete_post' : ActorMethod<[bigint], Result>,
  'undelete_thread' : ActorMethod<[bigint], Result>,
  'undelete_topic' : ActorMethod<[bigint], Result>,
  'update_forum' : ActorMethod<[bigint, CreateForumInput], Result>,
  'update_post' : ActorMethod<[bigint, [] | [string], string], Result>,
  'update_text_limits' : ActorMethod<[UpdateTextLimitsInput], Result>,
  'update_thread' : ActorMethod<[bigint, [] | [string], string], Result>,
  'update_topic' : ActorMethod<[bigint, CreateTopicInput], Result>,
  'vote_on_poll_with_neurons' : ActorMethod<
    [bigint, bigint, Array<NeuronId>],
    Result
  >,
  'vote_on_post' : ActorMethod<[bigint, VoteType], Result>,
  'vote_on_post_with_neurons' : ActorMethod<
    [bigint, VoteType, Array<NeuronId>],
    Result
  >,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
