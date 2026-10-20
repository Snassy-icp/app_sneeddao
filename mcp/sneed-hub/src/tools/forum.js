// Sneed forum (sneed_sns_forum, mcigm-4aaaa-aaaad-qhlkq-cai). Queries: get_forums,
// get_topics_by_forum, get_threads_by_activity, get_thread, get_thread_context,
// get_posts_by_thread, get_feed.
import { z } from 'zod';
import { forumActor, toPrincipal, opt, ptext, HUB_URL, CANISTERS } from '../ic.js';
import { result, safe, variantKey, nsToIso } from '../format.js';
import { namesOf, who } from './names.js';

const clip = (s, n) => (s == null ? null : s.length > n ? `${s.slice(0, n)}… [${s.length - n} more chars]` : s);
const snsQ = (root) => (root ? `&sns=${ptext(root)}` : '');

export function registerForumTools(server) {
  server.registerTool('forum_browse', {
    title: 'Browse the Sneed forum',
    description: `Browse the Sneed Hub forum (canister ${CANISTERS.sneed_sns_forum}). No arguments: list forums (one per SNS DAO). forum_id: its topics. topic_id: its threads by latest activity (paged). Uses get_forums, get_topics_by_forum, get_threads_by_activity.`,
    inputSchema: {
      forum_id: z.number().int().min(0).optional().describe('List topics of this forum'),
      topic_id: z.number().int().min(0).optional().describe('List threads of this topic, most recently active first'),
      offset: z.number().int().min(0).optional().describe('Threads page offset (default 0)'),
      limit: z.number().int().min(1).max(50).optional().describe('Threads page size (default 15)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ forum_id, topic_id, offset, limit }) => {
    const f = await forumActor();
    if (topic_id != null) {
      const topic = opt(await f.get_topic(BigInt(topic_id)));
      if (!topic) return result({ topic_id, found: false });
      const forum = opt(await f.get_forum(topic.forum_id));
      const root = forum ? opt(forum.sns_root_canister_id) : null;
      const page = await f.get_threads_by_activity(BigInt(topic_id), offset ? [BigInt(offset)] : [], BigInt(limit ?? 15), true);
      const names = await namesOf(page.threads.map((t) => t.created_by));
      return result({
        topic: { id: topic.id, title: topic.title, description: clip(topic.description, 300), forum: forum?.title, url: `${HUB_URL}/topic/${topic.id}${root ? `?sns=${ptext(root)}` : ''}` },
        has_more: page.has_more,
        next_offset: opt(page.next_start_from),
        threads: page.threads.filter((t) => !t.deleted).map((t) => ({
          id: t.id, title: opt(t.title), by: who(names, t.created_by), created_at: nsToIso(t.created_at),
          posts: opt(t.total_posts_count), preview: clip(t.body, 200), url: `${HUB_URL}/thread?threadid=${t.id}${snsQ(root)}`,
        })),
      });
    }
    if (forum_id != null) {
      const forum = opt(await f.get_forum(BigInt(forum_id)));
      if (!forum) return result({ forum_id, found: false });
      const topics = await f.get_topics_by_forum(BigInt(forum_id));
      const root = opt(forum.sns_root_canister_id);
      return result({
        forum: { id: forum.id, title: forum.title, sns_root: ptext(root) },
        topics: topics.filter((t) => !t.deleted).map((t) => ({ id: t.id, title: t.title, parent_topic_id: opt(t.parent_topic_id), description: clip(t.description, 200), url: `${HUB_URL}/topic/${t.id}${root ? `?sns=${ptext(root)}` : ''}` })),
      });
    }
    const forums = await f.get_forums();
    return result({
      sneed_hub_url: `${HUB_URL}/forum`,
      forums: forums.filter((x) => !x.deleted).map((x) => ({ id: x.id, title: x.title, description: clip(x.description, 200), sns_root: ptext(opt(x.sns_root_canister_id)) })),
    });
  }));

  server.registerTool('forum_read_thread', {
    title: 'Read a forum thread',
    description: 'A forum thread with its posts in order (paged by offset/limit). Uses get_thread, get_thread_context and get_posts_by_thread. Posts are public and show their author\'s principal.',
    inputSchema: {
      thread_id: z.number().int().min(0).describe('Thread id'),
      offset: z.number().int().min(0).optional().describe('Skip this many posts (default 0)'),
      limit: z.number().int().min(1).max(100).optional().describe('Posts per page (default 20)'),
      max_chars: z.number().int().min(100).max(20000).optional().describe('Clip each post body to this many characters (default 2000)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ thread_id, offset, limit, max_chars }) => {
    const f = await forumActor();
    const id = BigInt(thread_id);
    const [thread, ctx, posts] = await Promise.all([f.get_thread(id), f.get_thread_context(id), f.get_posts_by_thread(id)]);
    const t = opt(thread);
    if (!t) return result({ thread_id, found: false });
    const c = opt(ctx);
    const root = c ? opt(c.sns_root_canister_id) : null;
    const sorted = [...posts].sort((a, b) => (a.id < b.id ? -1 : 1));
    const start = offset ?? 0, n = limit ?? 20, mc = max_chars ?? 2000;
    const slice = sorted.slice(start, start + n);
    const names = await namesOf([t.created_by, ...slice.map((p) => p.created_by)]);
    return result({
      thread: { id: t.id, title: opt(t.title), by: who(names, t.created_by), created_at: nsToIso(t.created_at), body: clip(t.body, mc), topic_id: t.topic_id, forum_id: c?.forum_id, url: `${HUB_URL}/thread?threadid=${t.id}${snsQ(root)}` },
      total_posts: sorted.length,
      offset: start,
      next_offset: start + n < sorted.length ? start + n : null,
      posts: slice.map((p) => p.deleted
        ? { id: p.id, deleted: true }
        : {
          id: p.id, by: who(names, p.created_by), created_at: nsToIso(p.created_at), reply_to: opt(p.reply_to_post_id),
          title: opt(p.title), body: clip(p.body, mc), score: `+${p.upvote_score} / -${p.downvote_score} (neuron voting power)`,
        }),
    });
  }));

  server.registerTool('forum_recent', {
    title: 'Recent forum activity',
    description: 'Latest forum activity (new threads, posts, topics) across all forums or one SNS, newest first. Uses get_feed. Optional text search.',
    inputSchema: {
      sns_root: z.string().optional().describe('Only this SNS (root canister id); Sneed DAO is fp274-iaaaa-aaaaq-aacha-cai'),
      search: z.string().optional().describe('Only items containing this text'),
      limit: z.number().int().min(1).max(50).optional().describe('Items (default 15)'),
      before_id: z.number().int().min(0).optional().describe('Page: items older than this (use next_before_id)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ sns_root, search, limit, before_id }) => {
    const f = await forumActor();
    const filter = (sns_root || search) ? [{
      sns_root_canister_ids: sns_root ? [[toPrincipal(sns_root, 'SNS root canister id')]] : [],
      search_text: search ? [search] : [],
      creator_principals: [],
      topic_ids: [],
    }] : [];
    const page = await f.get_feed({ filter, length: BigInt(limit ?? 15), start_id: before_id != null ? [BigInt(before_id)] : [] });
    const names = await namesOf(page.items.map((i) => i.created_by));
    return result({
      has_more: page.has_more,
      next_before_id: opt(page.next_start_id),
      sneed_hub_url: `${HUB_URL}/feed`,
      items: page.items.map((i) => {
        const type = variantKey(i.item_type);
        const root = opt(i.sns_root_canister_id);
        const threadId = opt(i.thread_id);
        const url = type === 'post' ? `${HUB_URL}/post?postid=${i.id}${snsQ(root)}`
          : type === 'thread' ? `${HUB_URL}/thread?threadid=${i.id}${snsQ(root)}`
          : type === 'topic' ? `${HUB_URL}/topic/${i.id}${root ? `?sns=${ptext(root)}` : ''}`
          : `${HUB_URL}/forum`;
        return {
          type, id: i.id, by: who(names, i.created_by), at: nsToIso(i.created_at), forum: opt(i.forum_title), topic: opt(i.topic_title),
          thread: opt(i.thread_title) ?? undefined, thread_id: threadId ?? undefined, title: opt(i.title), body: clip(opt(i.body), 300), url,
        };
      }),
    });
  }));
}
