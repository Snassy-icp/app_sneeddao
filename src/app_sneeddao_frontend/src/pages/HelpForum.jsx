// /help/forum: the SNS forums, the activity feed, post voting, polls, tips and @-mentions.
import React from 'react';
import { FaComments, FaBook, FaRss, FaThumbsUp, FaPoll, FaCoins, FaAt, FaBell, FaShieldAlt, FaEdit, FaListUl } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpForum() {
    return (
        <HelpPage
            icon={FaComments}
            badgeIcon={FaBook}
            badge="Community"
            title="Forum, Feed and Tips"
            subtitle="Discuss with every SNS community on Sneed Hub: threads and replies, voting on posts with your neurons, polls, tips in any token and @-mentions."
            color="#6366f1"
            secondary="#818cf8"
        >
            <Section icon={FaComments} title="What it is" id="overview">
                <P>
                    The <L to="/forum">Forum</L> is an on-chain discussion board run by the Sneed forum canister. Every SNS
                    can have its own forum: pick the SNS in the dropdown in the header and the forum page shows that
                    SNS's topics. Each forum is organised as <B>topics</B> (which can have subtopics), <B>threads</B> inside
                    topics, and <B>posts</B> (replies) inside threads.
                </P>
                <P>
                    Each forum usually has a <B>Governance</B> topic with a <B>Proposals</B> subtopic, where every SNS proposal can
                    get its own discussion thread (you'll see a <B>Proposal Discussion</B> label on those), a <B>Preproposals</B> subtopic
                    for ideas before they become proposals, and a <B>General</B> topic for everything else.
                </P>
                <Warning title="Everything here is public">
                    Threads, posts, votes on posts, poll votes and tips are stored on-chain together with the principal that made
                    them, and anyone can read them. Your public Sneed name is shown next to them. Don't post anything you
                    wouldn't want to stay public.
                </Warning>
            </Section>

            <Section icon={FaListUl} title="Finding your way around" id="pages">
                <List>
                    <Li><L to="/forum">Forum</L>: the topics of the SNS selected in the header. Topics show their subtopics and threads. If an SNS has no forum yet, any logged-in user can press <B>Create Forum</B> to set one up; the same goes for a missing <B>General</B> or <B>Preproposals</B> topic.</Li>
                    <Li>A topic page lists its threads. Sort by <B>Recent Activity</B>, <B>Oldest Activity</B>, <B>Newest</B> or <B>Oldest</B>, and choose how many per page. Threads with posts you haven't seen yet are marked as unread.</Li>
                    <Li>A thread page shows the opening post and all replies. Use <B>View:</B> <B>Tree</B> (replies nested under what they answer) or <B>Flat</B>, and <B>Sort:</B> <B>Best Score</B>, <B>Newest First</B>, <B>Oldest First</B>, <B>Worst Score</B> or <B>Most Active</B>. Your choices are remembered in this browser.</Li>
                    <Li>A single post has its own page, focused on that post with its context, plus a list of who voted on it (neuron, voter and when).</Li>
                    <Li><L to="/posts">My Posts</L>: tabs for <B>My Posts</B>, <B>My Threads</B>, <B>Replies to Me</B> and <B>Mentions</B>.</Li>
                    <Li><L to="/tips">Tips</L>: <B>Tips Received</B> and <B>Tips Given</B>, with amount, date and a link to each post.</Li>
                </List>
            </Section>

            <Section icon={FaRss} title="The activity feed" id="feed">
                <P>
                    The <L to="/feed">Feed</L> shows new activity across all SNS forums in one stream: new forums, topics, threads
                    and posts, plus auctions from <L to="/sneedex">Sneedex</L>. When new items arrive while you're reading, a
                    banner says how many; click it to load them.
                </P>
                <List>
                    <Li>Click SNS logos at the top to show only some SNS forums, or clear the selection to show them all.</Li>
                    <Li>Open the advanced filters to search titles and content, filter by type (Forum, Topic, Thread, Post, Auction) and show only items by one user (pick them with the principal search box).</Li>
                    <Li>You can hide auctions from the feed if you only want discussions.</Li>
                </List>
            </Section>

            <Section icon={FaEdit} title="Posting" id="posting">
                <P>
                    Anyone who is logged in can create threads and reply; you don't need a neuron or voting power to post. You
                    can't post while logged out, and you can't reply in a deleted thread.
                </P>
                <Sub>Start a thread</Sub>
                <Steps>
                    <Li>Open a topic (for example General) from the <L to="/forum">Forum</L>.</Li>
                    <Li>Under <B>Start a New Thread</B>, enter a title and the body (<B>What would you like to discuss?</B>). Markdown and emoji are supported.</Li>
                    <Li>Optionally tick <B>Include a Poll</B> (see below).</Li>
                    <Li>Press <B>Create Thread</B> (or <B>Create Thread &amp; Poll</B>).</Li>
                </Steps>
                <Sub>Reply</Sub>
                <Steps>
                    <Li>On a thread, use <B>Add Your Comment</B> at the bottom to answer the thread, or press <B>Reply</B> on a post to answer that post.</Li>
                    <Li>Write your reply and press <B>Submit Reply</B>. In Tree view it appears under the post you answered.</Li>
                </Steps>
                <Sub>Length limits</Sub>
                <P>
                    By default titles can be up to 200 characters and thread and post bodies up to 10,000 characters.
                    Members of <L to="/premium">Sneed Premium</L> can write longer bodies (up to 50,000 characters by default).
                    Forum admins can change these limits.
                </P>
                <Sub>Edit and delete</Sub>
                <List>
                    <Li>You can edit your own posts (<B>Edit Post</B>) and your own threads (<B>Edit Thread</B>). Edits are saved on-chain like the original.</Li>
                    <Li>You can delete your own posts. It asks for confirmation first. Deleting hides the post for everyone except forum admins; it isn't wiped from the canister.</Li>
                    <Li>Threads can only be deleted by forum admins.</Li>
                </List>
            </Section>

            <Section icon={FaThumbsUp} title="Voting on posts" id="voting">
                <P>
                    Posts are voted up or down with SNS neuron voting power, not with likes. Each post shows its score (up
                    votes minus down votes, in voting power).
                </P>
                <Steps>
                    <Li>Add your Sneed Hub principal as a hotkey on your neurons in the SNS's governance (see <L to="/help/neurons">Neurons help</L>). The forum uses the neurons of the selected SNS where you have the vote permission.</Li>
                    <Li>On a thread, choose which of those neurons to vote with; the total is shown as <B>Total Selected Voting Power</B>.</Li>
                    <Li>Press the thumbs up or thumbs down on a post. Press the same button again to take your vote back.</Li>
                </Steps>
                <P>
                    If you have no neurons with voting power for that SNS, the vote buttons stay disabled. Posts with a
                    negative score are collapsed by default; click to expand them.
                </P>
            </Section>

            <Section icon={FaPoll} title="Polls" id="polls">
                <P>
                    A poll can be attached to a new thread (<B>Include a Poll</B>) or added to one of your own posts later
                    (the poll button on the post). Only the author of the thread or post can add a poll to it.
                </P>
                <List>
                    <Li>Give it a title, a description and at least two options (each can have its own description). Use <B>+ Add Option</B> for more.</Li>
                    <Li>Set an <B>End Date</B> and <B>End Time</B> in the future.</Li>
                    <Li><B>VP Power</B> sets how voting power counts: <B>Equal</B> (each neuron counts as one vote), <B>Square Root</B>, <B>Linear</B> (the default) or <B>Quadratic</B>.</Li>
                    <Li><B>Allow voters to change their votes</B> is on by default. If you turn it off, a vote can't be changed once cast.</Li>
                </List>
                <P>
                    To vote, select your neurons (hotkeyed as for post voting) and press <B>Vote</B> next to an option. Each option
                    shows its number of votes, its voting power and a percentage bar. Voting stops when the poll ends.
                </P>
            </Section>

            <Section icon={FaCoins} title="Tips" id="tips">
                <P>
                    You can thank a post's author by sending them tokens straight from your Sneed Hub wallet. The tokens go
                    to the author's principal, and the forum records the tip so it shows on the post for everyone.
                </P>
                <Steps>
                    <Li>On someone else's post, press the tip button (<B>Send a tip to the post author</B>). You can't tip your own posts.</Li>
                    <Li>Pick one of the tokens in your wallet and enter an amount, or press <B>MAX</B>. The dialog shows your <B>Available Balance</B> and the token's <B>Transaction Fee</B>.</Li>
                    <Li>Press <B>Send Tip</B>. The app first transfers the tokens (<B>Sending Tip...</B>), then records the tip in the forum (<B>Registering Tip...</B>).</Li>
                </Steps>
                <Warning title="Tips are real transfers">
                    A tip sends real tokens and can't be undone. The ledger's transaction fee is paid on top of the amount.
                    Tips are public: who tipped whom, which token and how much show on the post and on <L to="/tips">Tips</L>.
                </Warning>
                <Tip title="Tip again with one click">
                    Existing tips show as small token pills on a post. Click a pill to see its details, then use its tip button
                    to open the tip dialog with that token already chosen.
                </Tip>
            </Section>

            <Section icon={FaAt} title="@-mentions" id="mentions">
                <P>
                    In thread and post bodies, type <Code>@</Code> followed by part of a Sneed name. A picker opens (the same one
                    as the principal search box, with its tabs and user and canister toggles); use the arrow keys and Enter or
                    Tab, or click, to pick someone. In the search, <Code>_</Code> and <Code>-</Code> stand for spaces.
                </P>
                <List>
                    <Li>The mention is saved as a link to the person's principal, so it keeps working if they rename. In posts it shows as a chip with their current public name, linking to their page.</Li>
                    <Li>You can find people by your private nickname for them, but only their public name (or a short principal) is written into the post. Your nicknames stay private.</Li>
                    <Li>Up to 10 people per thread or post are counted as mentioned. Mentioning yourself doesn't notify anyone, and editing a post only notifies people you newly added.</Li>
                    <Li>Mentioned people see it in the header and under the <B>Mentions</B> tab on <L to="/posts">My Posts</L>.</Li>
                </List>
                <Sub>SMS when mentioned (opt-in)</Sub>
                <P>
                    On your <L to="/me">Me</L> page, in the settings, turn on <B>SMS When Mentioned</B> to also get a Sneed SMS
                    direct message when someone mentions you. The message is sent from the poster's own principal, with an
                    excerpt and a link, so you can reply to them directly. Whether you opted in is stored in the forum canister.
                </P>
                <Info title="These SMS come from the poster">
                    Because the mention SMS is sent by the poster's account, it counts toward the poster's Sneed SMS sending
                    limits. If they recently sent a message, the SMS may be skipped; the mention itself is always recorded.
                </Info>
            </Section>

            <Section icon={FaBell} title="How you're notified" id="notifications">
                <List>
                    <Li><B>In the header</B>: counters for new replies to your posts, new mentions and new tips. Click them to go to <L to="/posts">My Posts</L> or <L to="/tips">Tips</L>. You can switch them on or off on your <L to="/me">Me</L> page: <B>Reply Notifications</B> covers replies and mentions, <B>Tip Notifications</B> covers tips.</Li>
                    <Li><B>Sneed SMS</B>: mentions, if you opted in (see above).</Li>
                    <Li><B>Sneed Notifications</B>: when the forum is connected to it, the forum also hands replies to your posts or threads, mentions and tips to <L to="/notifications">Sneed Notifications</L>. They reach you only if you allowed Sneed Hub to notify you there, through the channels you chose. See <L to="/help/notifications">Notifications help</L>.</Li>
                </List>
            </Section>

            <Section icon={FaShieldAlt} title="Moderation" id="moderation">
                <List>
                    <Li>The community moderates first: posts voted below zero are collapsed by default.</Li>
                    <Li>Forum admins can edit or delete any post or thread and can delete topics. Deleted items are hidden from everyone but admins, and admins can restore them.</Li>
                    <Li>If you see something wrong, use <L to="/feedback">Feedback</L> to report it.</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/sms', label: 'Sneed SMS', text: 'private direct messages between principals' },
                { to: '/help/notifications', label: 'Notifications', text: 'where replies, mentions and tips can reach you' },
                { to: '/help/neurons', label: 'Neurons', text: 'hotkeys and voting power for post votes and polls' },
                { to: '/help/wallet', label: 'Wallet', text: 'the tokens you tip with' },
            ]} />
        </HelpPage>
    );
}
