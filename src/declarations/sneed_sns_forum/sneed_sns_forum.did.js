export const idlFactory = ({ IDL }) => {
  const ForumError = IDL.Variant({
    'InvalidInput' : IDL.Text,
    'NotFound' : IDL.Text,
    'Unauthorized' : IDL.Text,
    'AlreadyExists' : IDL.Text,
    'InternalError' : IDL.Text,
  });
  const Result = IDL.Variant({ 'ok' : IDL.Null, 'err' : ForumError });
  const CreateForumInput = IDL.Record({
    'sns_root_canister_id' : IDL.Opt(IDL.Principal),
    'title' : IDL.Text,
    'description' : IDL.Text,
  });
  const Result_1 = IDL.Variant({ 'ok' : IDL.Nat, 'err' : ForumError });
  const CreatePollOptionInput = IDL.Record({
    'title' : IDL.Text,
    'body' : IDL.Opt(IDL.Text),
  });
  const CreatePollInput = IDL.Record({
    'title' : IDL.Text,
    'post_id' : IDL.Opt(IDL.Nat),
    'end_timestamp' : IDL.Int,
    'body' : IDL.Text,
    'vp_power' : IDL.Opt(IDL.Float64),
    'allow_vote_changes' : IDL.Opt(IDL.Bool),
    'thread_id' : IDL.Nat,
    'options' : IDL.Vec(CreatePollOptionInput),
  });
  const CreateProposalThreadInput = IDL.Record({
    'sns_root_canister_id' : IDL.Principal,
    'proposal_id' : IDL.Nat,
  });
  const SpecialTopicType = IDL.Variant({
    'General' : IDL.Null,
    'Preproposals' : IDL.Null,
    'Governance' : IDL.Null,
  });
  const CreateSpecialTopicInput = IDL.Record({
    'sns_root_canister_id' : IDL.Principal,
    'special_topic_type' : SpecialTopicType,
  });
  const CreateThreadInput = IDL.Record({
    'title' : IDL.Opt(IDL.Text),
    'body' : IDL.Text,
    'topic_id' : IDL.Nat,
  });
  const CreateTopicInput = IDL.Record({
    'forum_id' : IDL.Nat,
    'title' : IDL.Text,
    'parent_topic_id' : IDL.Opt(IDL.Nat),
    'description' : IDL.Text,
  });
  const AdminInfo = IDL.Record({
    'principal' : IDL.Principal,
    'added_at' : IDL.Int,
    'added_by' : IDL.Nat32,
  });
  const FeedFilter = IDL.Record({
    'creator_principals' : IDL.Opt(IDL.Vec(IDL.Principal)),
    'topic_ids' : IDL.Opt(IDL.Vec(IDL.Nat)),
    'search_text' : IDL.Opt(IDL.Text),
    'sns_root_canister_ids' : IDL.Opt(IDL.Vec(IDL.Principal)),
  });
  const GetFeedInput = IDL.Record({
    'start_id' : IDL.Opt(IDL.Nat),
    'filter' : IDL.Opt(FeedFilter),
    'length' : IDL.Nat,
  });
  const FeedItemType = IDL.Variant({
    'forum' : IDL.Null,
    'topic' : IDL.Null,
    'post' : IDL.Null,
    'thread' : IDL.Null,
  });
  const FeedItem = IDL.Record({
    'id' : IDL.Nat,
    'poll_id' : IDL.Opt(IDL.Nat),
    'sns_root_canister_id' : IDL.Opt(IDL.Principal),
    'forum_id' : IDL.Opt(IDL.Nat),
    'title' : IDL.Opt(IDL.Text),
    'body' : IDL.Opt(IDL.Text),
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
    'item_type' : FeedItemType,
    'topic_id' : IDL.Opt(IDL.Nat),
    'forum_title' : IDL.Opt(IDL.Text),
    'topic_title' : IDL.Opt(IDL.Text),
    'thread_id' : IDL.Opt(IDL.Nat),
    'thread_title' : IDL.Opt(IDL.Text),
    'replied_to_post' : IDL.Opt(
      IDL.Record({
        'id' : IDL.Nat,
        'title' : IDL.Opt(IDL.Text),
        'body' : IDL.Text,
      })
    ),
  });
  const GetFeedResponse = IDL.Record({
    'items' : IDL.Vec(FeedItem),
    'has_more' : IDL.Bool,
    'next_start_id' : IDL.Opt(IDL.Nat),
  });
  const ForumResponse = IDL.Record({
    'id' : IDL.Nat,
    'sns_root_canister_id' : IDL.Opt(IDL.Principal),
    'title' : IDL.Text,
    'updated_at' : IDL.Int,
    'updated_by' : IDL.Principal,
    'deleted' : IDL.Bool,
    'description' : IDL.Text,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
  });
  const GetLastReadPostRequest = IDL.Record({ 'thread_id' : IDL.Nat });
  const GetLastReadPostResponse = IDL.Record({
    'last_read_post_id' : IDL.Opt(IDL.Nat),
  });
  const PollOptionResponse = IDL.Record({
    'id' : IDL.Nat,
    'title' : IDL.Text,
    'body' : IDL.Opt(IDL.Text),
    'vote_count' : IDL.Nat,
    'total_voting_power' : IDL.Nat,
  });
  const PollResponse = IDL.Record({
    'id' : IDL.Nat,
    'title' : IDL.Text,
    'updated_at' : IDL.Int,
    'updated_by' : IDL.Principal,
    'deleted' : IDL.Bool,
    'post_id' : IDL.Opt(IDL.Nat),
    'end_timestamp' : IDL.Int,
    'body' : IDL.Text,
    'vp_power' : IDL.Float64,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
    'has_ended' : IDL.Bool,
    'allow_vote_changes' : IDL.Bool,
    'thread_id' : IDL.Nat,
    'options' : IDL.Vec(PollOptionResponse),
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
  const PollVoteResponse = IDL.Record({
    'poll_id' : IDL.Nat,
    'updated_at' : IDL.Int,
    'created_at' : IDL.Int,
    'voter_principal' : IDL.Principal,
    'option_id' : IDL.Nat,
    'voting_power' : IDL.Nat,
    'neuron_id' : NeuronId,
  });
  const PostResponse = IDL.Record({
    'id' : IDL.Nat,
    'title' : IDL.Opt(IDL.Text),
    'updated_at' : IDL.Int,
    'updated_by' : IDL.Principal,
    'deleted' : IDL.Bool,
    'downvote_score' : IDL.Nat,
    'body' : IDL.Text,
    'upvote_score' : IDL.Nat,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
    'thread_id' : IDL.Nat,
    'reply_to_post_id' : IDL.Opt(IDL.Nat),
  });
  const VoteType = IDL.Variant({ 'upvote' : IDL.Null, 'downvote' : IDL.Null });
  const VoteResponse = IDL.Record({
    'updated_at' : IDL.Int,
    'post_id' : IDL.Nat,
    'vote_type' : VoteType,
    'created_at' : IDL.Int,
    'voter_principal' : IDL.Principal,
    'voting_power' : IDL.Nat,
    'neuron_id' : NeuronId,
  });
  const NeuronVote = IDL.Record({
    'updated_at' : IDL.Int,
    'vote_type' : VoteType,
    'created_at' : IDL.Int,
    'voting_power' : IDL.Nat,
    'neuron_id' : NeuronId,
  });
  const ThreadVoteResponse = IDL.Record({
    'post_id' : IDL.Nat,
    'neuron_votes' : IDL.Vec(NeuronVote),
  });
  const ProposalThreadMappingResponse = IDL.Record({
    'sns_root_canister_id' : IDL.Principal,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
    'proposal_id' : IDL.Nat,
    'thread_id' : IDL.Nat,
  });
  const ProposalTopicMappingResponse = IDL.Record({
    'proposals_topic_id' : IDL.Nat,
    'forum_id' : IDL.Nat,
    'set_at' : IDL.Int,
    'set_by' : IDL.Principal,
  });
  const TipResponse = IDL.Record({
    'id' : IDL.Nat,
    'post_id' : IDL.Nat,
    'to_principal' : IDL.Principal,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
    'from_principal' : IDL.Principal,
    'token_ledger_principal' : IDL.Principal,
    'transaction_block_index' : IDL.Opt(IDL.Nat),
    'thread_id' : IDL.Nat,
    'amount' : IDL.Nat,
  });
  const ForumStats = IDL.Record({
    'total_forums' : IDL.Nat,
    'total_posts' : IDL.Nat,
    'total_votes' : IDL.Nat,
    'total_topics' : IDL.Nat,
    'total_threads' : IDL.Nat,
  });
  const TopicResponse = IDL.Record({
    'id' : IDL.Nat,
    'forum_id' : IDL.Nat,
    'title' : IDL.Text,
    'updated_at' : IDL.Int,
    'updated_by' : IDL.Principal,
    'deleted' : IDL.Bool,
    'parent_topic_id' : IDL.Opt(IDL.Nat),
    'description' : IDL.Text,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
  });
  const TextLimits = IDL.Record({
    'thread_body_max_length' : IDL.Nat,
    'forum_description_max_length' : IDL.Nat,
    'thread_title_max_length' : IDL.Nat,
    'topic_title_max_length' : IDL.Nat,
    'forum_title_max_length' : IDL.Nat,
    'post_title_max_length' : IDL.Nat,
    'topic_description_max_length' : IDL.Nat,
    'post_body_max_length' : IDL.Nat,
  });
  const ThreadResponse = IDL.Record({
    'id' : IDL.Nat,
    'title' : IDL.Opt(IDL.Text),
    'updated_at' : IDL.Int,
    'updated_by' : IDL.Principal,
    'deleted' : IDL.Bool,
    'total_posts_count' : IDL.Opt(IDL.Nat),
    'body' : IDL.Text,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
    'topic_id' : IDL.Nat,
    'unread_posts_count' : IDL.Opt(IDL.Nat),
  });
  const ThreadContextResponse = IDL.Record({
    'sns_root_canister_id' : IDL.Opt(IDL.Principal),
    'forum_id' : IDL.Nat,
    'topic_id' : IDL.Nat,
    'thread_id' : IDL.Nat,
  });
  const GetThreadsByActivityResponse = IDL.Record({
    'threads' : IDL.Vec(ThreadResponse),
    'next_start_from' : IDL.Opt(IDL.Nat),
    'has_more' : IDL.Bool,
  });
  const TipStats = IDL.Record({
    'total_tips' : IDL.Nat,
    'total_tip_amount_by_token' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat)),
  });
  const TipTokenSummary = IDL.Record({
    'total_amount' : IDL.Nat,
    'token_ledger_principal' : IDL.Principal,
    'tip_count' : IDL.Nat,
  });
  const TopicStatistics = IDL.Record({
    'thread_count' : IDL.Nat,
    'topic_id' : IDL.Nat,
    'total_unread_posts' : IDL.Nat,
  });
  const SetLastReadPostRequest = IDL.Record({
    'last_read_post_id' : IDL.Nat,
    'thread_id' : IDL.Nat,
  });
  const SetLastReadPostResponse = IDL.Record({
    'message' : IDL.Text,
    'success' : IDL.Bool,
  });
  const SetProposalTopicInput = IDL.Record({
    'forum_id' : IDL.Nat,
    'topic_id' : IDL.Nat,
  });
  const UpdateTextLimitsInput = IDL.Record({
    'thread_body_max_length' : IDL.Opt(IDL.Nat),
    'forum_description_max_length' : IDL.Opt(IDL.Nat),
    'thread_title_max_length' : IDL.Opt(IDL.Nat),
    'topic_title_max_length' : IDL.Opt(IDL.Nat),
    'forum_title_max_length' : IDL.Opt(IDL.Nat),
    'post_title_max_length' : IDL.Opt(IDL.Nat),
    'topic_description_max_length' : IDL.Opt(IDL.Nat),
    'post_body_max_length' : IDL.Opt(IDL.Nat),
  });
  return IDL.Service({
    'add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'create_forum' : IDL.Func([CreateForumInput], [Result_1], []),
    'create_poll' : IDL.Func([CreatePollInput], [Result_1], []),
    'create_post' : IDL.Func(
        [IDL.Nat, IDL.Opt(IDL.Nat), IDL.Opt(IDL.Text), IDL.Text],
        [Result_1],
        [],
      ),
    'create_proposal_thread' : IDL.Func(
        [CreateProposalThreadInput],
        [Result_1],
        [],
      ),
    'create_proposal_thread_with_auto_setup' : IDL.Func(
        [CreateProposalThreadInput],
        [Result_1],
        [],
      ),
    'create_sns_forum_setup' : IDL.Func([IDL.Principal], [Result_1], []),
    'create_special_topic' : IDL.Func(
        [CreateSpecialTopicInput],
        [Result_1],
        [],
      ),
    'create_thread' : IDL.Func([CreateThreadInput], [Result_1], []),
    'create_tip' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Principal, IDL.Nat, IDL.Opt(IDL.Nat)],
        [Result_1],
        [],
      ),
    'create_topic' : IDL.Func([CreateTopicInput], [Result_1], []),
    'delete_forum' : IDL.Func([IDL.Nat], [Result], []),
    'delete_post' : IDL.Func([IDL.Nat], [Result], []),
    'delete_thread' : IDL.Func([IDL.Nat], [Result], []),
    'delete_topic' : IDL.Func([IDL.Nat], [Result], []),
    'get_admins' : IDL.Func([], [IDL.Vec(AdminInfo)], ['query']),
    'get_current_counter' : IDL.Func([], [IDL.Nat], ['query']),
    'get_feed' : IDL.Func([GetFeedInput], [GetFeedResponse], ['query']),
    'get_forum' : IDL.Func([IDL.Nat], [IDL.Opt(ForumResponse)], ['query']),
    'get_forum_admin' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(ForumResponse)],
        ['query'],
      ),
    'get_forum_by_sns_root' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(ForumResponse)],
        ['query'],
      ),
    'get_forums' : IDL.Func([], [IDL.Vec(ForumResponse)], ['query']),
    'get_forums_admin' : IDL.Func([], [IDL.Vec(ForumResponse)], ['query']),
    'get_last_read_post' : IDL.Func(
        [GetLastReadPostRequest],
        [GetLastReadPostResponse],
        ['query'],
      ),
    'get_last_seen_replies_timestamp' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(IDL.Int)],
        ['query'],
      ),
    'get_last_seen_tip_timestamp' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(IDL.Int)],
        ['query'],
      ),
    'get_poll' : IDL.Func([IDL.Nat], [IDL.Opt(PollResponse)], ['query']),
    'get_poll_votes' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(PollVoteResponse)],
        ['query'],
      ),
    'get_polls_by_post' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(PollResponse)],
        ['query'],
      ),
    'get_polls_by_thread' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(PollResponse)],
        ['query'],
      ),
    'get_post' : IDL.Func([IDL.Nat], [IDL.Opt(PostResponse)], ['query']),
    'get_post_admin' : IDL.Func([IDL.Nat], [IDL.Opt(PostResponse)], ['query']),
    'get_post_replies' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(PostResponse)],
        ['query'],
      ),
    'get_post_replies_admin' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(PostResponse)],
        ['query'],
      ),
    'get_post_votes' : IDL.Func([IDL.Nat], [IDL.Vec(VoteResponse)], ['query']),
    'get_post_votes_for_neurons' : IDL.Func(
        [IDL.Nat, IDL.Vec(NeuronId)],
        [IDL.Opt(ThreadVoteResponse)],
        ['query'],
      ),
    'get_posts_by_thread' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(PostResponse)],
        ['query'],
      ),
    'get_posts_by_thread_admin' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(PostResponse)],
        ['query'],
      ),
    'get_posts_by_user' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(PostResponse)],
        ['query'],
      ),
    'get_proposal_thread' : IDL.Func(
        [IDL.Principal, IDL.Nat],
        [IDL.Opt(ProposalThreadMappingResponse)],
        ['query'],
      ),
    'get_proposals_topic' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(ProposalTopicMappingResponse)],
        ['query'],
      ),
    'get_proposals_topic_by_sns_root' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(ProposalTopicMappingResponse)],
        ['query'],
      ),
    'get_recent_replies_count' : IDL.Func(
        [IDL.Principal],
        [IDL.Nat],
        ['query'],
      ),
    'get_recent_tips_count' : IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
    'get_recent_tips_received' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(TipResponse)],
        ['query'],
      ),
    'get_replies_to_user' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(PostResponse)],
        ['query'],
      ),
    'get_stats' : IDL.Func([], [ForumStats], ['query']),
    'get_subtopics' : IDL.Func([IDL.Nat], [IDL.Vec(TopicResponse)], ['query']),
    'get_text_limits' : IDL.Func([], [TextLimits], ['query']),
    'get_thread' : IDL.Func([IDL.Nat], [IDL.Opt(ThreadResponse)], ['query']),
    'get_thread_admin' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(ThreadResponse)],
        ['query'],
      ),
    'get_thread_context' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(ThreadContextResponse)],
        ['query'],
      ),
    'get_thread_proposal_id' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(IDL.Tuple(IDL.Nat32, IDL.Nat))],
        ['query'],
      ),
    'get_thread_votes_for_neurons' : IDL.Func(
        [IDL.Nat, IDL.Vec(NeuronId)],
        [IDL.Vec(ThreadVoteResponse)],
        ['query'],
      ),
    'get_threads_by_activity' : IDL.Func(
        [IDL.Nat, IDL.Opt(IDL.Nat), IDL.Nat, IDL.Bool],
        [GetThreadsByActivityResponse],
        ['query'],
      ),
    'get_threads_by_activity_with_unread_counts' : IDL.Func(
        [IDL.Nat, IDL.Opt(IDL.Nat), IDL.Nat, IDL.Bool],
        [GetThreadsByActivityResponse],
        ['query'],
      ),
    'get_threads_by_topic' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(ThreadResponse)],
        ['query'],
      ),
    'get_threads_by_topic_admin' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(ThreadResponse)],
        ['query'],
      ),
    'get_threads_by_topic_with_unread_counts' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(ThreadResponse)],
        ['query'],
      ),
    'get_threads_by_user' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(ThreadResponse)],
        ['query'],
      ),
    'get_tip' : IDL.Func([IDL.Nat], [IDL.Opt(TipResponse)], ['query']),
    'get_tip_stats' : IDL.Func([], [TipStats], ['query']),
    'get_tip_tokens_received_by_user' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(TipTokenSummary)],
        ['query'],
      ),
    'get_tips_by_post' : IDL.Func([IDL.Nat], [IDL.Vec(TipResponse)], ['query']),
    'get_tips_by_thread' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(TipResponse)],
        ['query'],
      ),
    'get_tips_given_by_user' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(TipResponse)],
        ['query'],
      ),
    'get_tips_received_by_user' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(TipResponse)],
        ['query'],
      ),
    'get_tips_received_since' : IDL.Func(
        [IDL.Principal, IDL.Int],
        [IDL.Vec(TipResponse)],
        ['query'],
      ),
    'get_topic' : IDL.Func([IDL.Nat], [IDL.Opt(TopicResponse)], ['query']),
    'get_topic_admin' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(TopicResponse)],
        ['query'],
      ),
    'get_topic_statistics' : IDL.Func([IDL.Nat], [TopicStatistics], ['query']),
    'get_topics_by_forum' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(TopicResponse)],
        ['query'],
      ),
    'get_topics_by_forum_admin' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(TopicResponse)],
        ['query'],
      ),
    'get_user_thread_reads_for_topic' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(IDL.Tuple(IDL.Nat, IDL.Nat))],
        ['query'],
      ),
    'health_check' : IDL.Func([], [IDL.Bool], ['query']),
    'is_admin' : IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
    'mark_replies_seen_up_to' : IDL.Func([IDL.Int], [], []),
    'mark_tips_seen_up_to' : IDL.Func([IDL.Int], [], []),
    'remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'remove_proposals_topic' : IDL.Func([IDL.Nat], [Result], []),
    'retract_vote' : IDL.Func([IDL.Nat], [Result], []),
    'retract_vote_with_neurons' : IDL.Func(
        [IDL.Nat, IDL.Vec(NeuronId)],
        [Result],
        [],
      ),
    'set_last_read_post' : IDL.Func(
        [SetLastReadPostRequest],
        [SetLastReadPostResponse],
        [],
      ),
    'set_proposals_topic' : IDL.Func([SetProposalTopicInput], [Result], []),
    'undelete_forum' : IDL.Func([IDL.Nat], [Result], []),
    'undelete_post' : IDL.Func([IDL.Nat], [Result], []),
    'undelete_thread' : IDL.Func([IDL.Nat], [Result], []),
    'undelete_topic' : IDL.Func([IDL.Nat], [Result], []),
    'update_forum' : IDL.Func([IDL.Nat, CreateForumInput], [Result], []),
    'update_post' : IDL.Func(
        [IDL.Nat, IDL.Opt(IDL.Text), IDL.Text],
        [Result],
        [],
      ),
    'update_text_limits' : IDL.Func([UpdateTextLimitsInput], [Result], []),
    'update_thread' : IDL.Func(
        [IDL.Nat, IDL.Opt(IDL.Text), IDL.Text],
        [Result],
        [],
      ),
    'update_topic' : IDL.Func([IDL.Nat, CreateTopicInput], [Result], []),
    'vote_on_poll_with_neurons' : IDL.Func(
        [IDL.Nat, IDL.Nat, IDL.Vec(NeuronId)],
        [Result],
        [],
      ),
    'vote_on_post' : IDL.Func([IDL.Nat, VoteType], [Result], []),
    'vote_on_post_with_neurons' : IDL.Func(
        [IDL.Nat, VoteType, IDL.Vec(NeuronId)],
        [Result],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
