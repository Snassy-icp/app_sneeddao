// /help/notifications: Sneed Notifications at /notifications (apps, levels, channels, balance, history).
import React from 'react';
import { FaBell, FaBook, FaPlug, FaInbox, FaMoon, FaMobileAlt, FaDiscord, FaWallet, FaHistory, FaComments, FaShieldAlt, FaSlidersH } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpNotifications() {
    return (
        <HelpPage
            icon={FaBell}
            badgeIcon={FaBook}
            badge="Community"
            title="Notifications"
            subtitle="Choose which apps may notify you, about what, and where the messages go: your Sneed SMS inbox, your phone, or Discord. Nothing reaches you from an app you haven't allowed."
            color="#f59e0b"
            secondary="#fbbf24"
        >
            <Section icon={FaBell} title="What it is" id="overview">
                <P>
                    Sneed Notifications is a notification centre on the Internet Computer. Apps (canisters) register with it and
                    send short messages to the people who allowed them. You manage everything on the <L to="/notifications">Notifications</L> page,
                    which you also reach from <L to="/me">Me</L> under <B>Notifications from apps</B>.
                </P>
                <P>The page is split into cards:</P>
                <List>
                    <Li><B>Apps asking to notify you</B>: requests waiting for your answer (only shown when there are any).</Li>
                    <Li><B>How you're notified</B>: where each level of message goes, the always-copy channel, quiet hours and pausing.</Li>
                    <Li><B>Apps</B> and <B>Other apps</B>: the apps you have decided on, and the ones you haven't yet.</Li>
                    <Li><B>Channels</B>: Sneed SMS, plus phone push and Discord when they are available.</Li>
                    <Li><B>Balance</B>: the ICP that pays for deliveries on paid channels.</Li>
                    <Li><B>Recent</B>: what you were sent and what happened to each delivery.</Li>
                </List>
                <Info title="Log in first">
                    The page needs you to be logged in. If the notification service has not been set up on the network you are using,
                    the page says it isn't live yet and shows nothing else.
                </Info>
            </Section>

            <Section icon={FaComments} title="What Sneed Hub notifies you about" id="sneed-hub-events">
                <P>Sneed Hub's own forum and Sneed SMS can send these messages, as long as you allowed Sneed Hub as an app:</P>
                <List>
                    <Li><B>Replies</B>: someone replied to your post, or posted in a thread you started ("New reply in ..."). You aren't told about your own posts, and if the reply also mentions you, you get the mention instead, not both.</Li>
                    <Li><B>Mentions</B>: someone mentioned you in a post or thread ("You were mentioned in ...").</Li>
                    <Li><B>Tips</B>: someone tipped one of your posts ("Your post got a tip").</Li>
                    <Li>
                        <B>Direct messages</B>: someone sent you a <L to="/sms">Sneed SMS</L> ("New message from ..."). It shows the subject and a
                        link to the message, and the first 100 characters of the text unless you turn previews off on this page. It goes to your other channels (phone, Discord...) only, not to your
                        Sneed SMS inbox: the message is there already.
                    </Li>
                </List>
                <P>
                    Each forum message has a short excerpt and a link straight to the post. These are separate from the bell and banners in
                    the header, which Sneed Hub shows on its own while you have the site open.
                </P>
            </Section>

            <Section icon={FaPlug} title="Apps, topics and consent" id="apps">
                <P>
                    An app has a name, a description and a list of <B>topics</B> (the kinds of message it sends, such as replies or
                    mentions). A blue tick next to the name means the app is <B>verified</B> by the service. An app can ask to notify you;
                    the request then appears under <B>Apps asking to notify you</B> with <B>Allow</B> and <B>Block</B> buttons.
                    Apps you haven't decided on are listed under <B>Other apps</B>, where you can allow them yourself.
                </P>
                <Steps>
                    <Li>Open <L to="/notifications">Notifications</L> and find the app under <B>Apps asking to notify you</B> or <B>Other apps</B>.</Li>
                    <Li>Read its description and topics, then press <B>Allow</B> (or <B>Block</B>).</Li>
                    <Li>Under <B>Apps</B>, click the app's name to open its settings. You can switch it between <B>Allow</B> and <B>Block</B> at any time.</Li>
                </Steps>
                <Sub>Per-app settings</Sub>
                <List>
                    <Li><B>Demote everything one level</B>: urgent becomes normal, normal becomes info.</Li>
                    <Li><B>Only to my copy channel</B>: the app's messages go only to your always-copy channel, never to your phone or Discord.</Li>
                    <Li><B>At most ... messages a day</B>: once the app has sent that many today, further messages are refused.</Li>
                    <Li><B>It may cost me at most ... ICP a day</B>: a spending cap for this app on paid channels (see <L to="/help/notifications#paying">paying</L>).</Li>
                    <Li>For each topic, a choice of <B>As declared</B>, <B>Treat as urgent</B>, <B>Treat as normal</B>, <B>Treat as info</B> or <B>Mute</B>.</Li>
                </List>
                <P>The caps are saved when you click out of the box; the other choices are saved straight away.</P>
                <Tip title="Blocking is instant">
                    A blocked app's messages are refused, and so are messages on a muted topic: they don't reach any channel.
                </Tip>
            </Section>

            <Section icon={FaSlidersH} title="Levels and where they go" id="levels">
                <P>Every topic is sent at one of three levels:</P>
                <List>
                    <Li><B>Urgent</B>: needs action soon, such as low cycles, a vote ending or funds received.</Li>
                    <Li><B>Normal</B>: activity, such as replies, sales and mentions.</Li>
                    <Li><B>Info</B>: news and announcements.</Li>
                </List>
                <P>
                    In <B>How you're notified</B>, a table has one row per level and one column per ready channel. Tick the boxes to
                    choose where each level goes, then press <B>Save</B>.
                </P>
                <Sub>Always copy to</Sub>
                <P>
                    Under the table, <B>Always copy to</B> picks one channel that gets a copy of every message, whatever its level, so
                    nothing exists only as a phone banner. It starts as <B>Sneed SMS</B>. You can choose another ready channel, or
                    <B> Nothing</B>. Muted topics are not copied.
                </P>
                <Info title="The default">
                    Until you change anything, the level table is empty and every message is copied to your Sneed SMS inbox. When you
                    verify a new channel, urgent and normal messages are switched on for it automatically.
                </Info>
            </Section>

            <Section icon={FaMoon} title="Quiet hours and pausing" id="quiet">
                <List>
                    <Li><B>Quiet hours</B>: tick <B>Hold messages</B> and set <B>from</B> and <B>to</B> (it starts at 22:00 to 07:00). Phone and chat channels wait until the quiet hours end; Sneed SMS copies arrive anyway. Tick <B>Urgent gets through</B> to let urgent messages through at night. Your time zone is taken from the device you save on. Press <B>Save</B>.</Li>
                    <Li><B>Pause everything</B>: press <B>1 hour</B> or <B>1 day</B>. While paused, the page says <B>Paused until ...</B>; press <B>Resume</B> to end it early. A pause stops messages going to your level channels; your always-copy channel still gets its copy.</Li>
                </List>
            </Section>

            <Section icon={FaInbox} title="Channels" id="channels">
                <Sub>Sneed SMS (always there)</Sub>
                <P>
                    Everyone has a <B>Sneed SMS</B> channel. It is your inbox: messages land in <L to="/sms">Sneed SMS</L> and the bell in
                    the header, titled with the app's name in brackets and ending with a link back to the notification settings. It is
                    free and can't be removed.
                </P>
                <Sub>Phone and computer push</Sub>
                <P>
                    When a push relay is running, the Channels card shows <B>Get notifications on this device</B>. Each device you add
                    becomes its own channel (named iPhone, Android phone or This computer).
                </P>
                <Steps>
                    <Li>On iPhone or iPad, first install Sneed Hub on your home screen and open it from there (see <L to="/help/app">the app help</L>). In Safari itself the button isn't offered.</Li>
                    <Li>Open <L to="/notifications">Notifications</L> on that device and press <B>Get notifications on this device</B>.</Li>
                    <Li>When the browser or phone asks, allow notifications. If you said no earlier, turn them on again in the browser or system settings.</Li>
                    <Li>A six-digit code arrives as a notification. Type it next to <B>Code sent to ...</B> and press <B>Verify</B>.</Li>
                </Steps>
                <P>Tapping a push notification opens the link it carries, or the Notifications page.</P>
                <Sub>Discord</Sub>
                <P>When a Discord relay is running, you can add Discord. Mr Sneed's Discord bot sends you a direct message, so you need to share a server with him (the Sneed Discord) and allow direct messages from its members.</P>
                <Steps>
                    <Li>In Discord, turn on Settings, Advanced, <B>Developer Mode</B>, then right-click your name and choose <B>Copy User ID</B>.</Li>
                    <Li>Paste it into <B>Your Discord user id</B> and press <B>Add Discord</B>.</Li>
                    <Li>Mr Sneed DMs you a six-digit code. Type it in and press <B>Verify</B>.</Li>
                </Steps>
                <P>
                    A channel waiting for its code shows <B>waiting for the code</B>; a verified one shows <B>ready</B>. The code is valid
                    for a day. If it expires or never arrives, press <B>Send a new code</B>. Five wrong codes also end a code, and you
                    can add up to five channels a day: codes go to whatever address is typed in, so this stops anyone using them
                    to pester someone else. If no relay is running, the card lists these
                    channels as coming soon. Telegram and email are also listed as coming soon.
                </P>
                <Info title="Your addresses are encrypted">
                    Your Discord id and device push address are encrypted in your browser to the relay that delivers them. The
                    notification canister and other apps can't read them. Removing a channel deletes it.
                </Info>
            </Section>

            <Section icon={FaWallet} title="Balance and paying" id="paying">
                <P>
                    You pay for your own deliveries on paid channels (phone push, Discord and so on). Sneed SMS is free. Each delivery to
                    a paid channel costs a small amount of ICP, taken from your notification balance, shown on the <B>Balance</B> card.
                </P>
                <List>
                    <Li><B>Not enough balance</B>: the delivery to that channel is skipped, while free channels still get the message.</Li>
                    <Li><B>Low-balance alert</B>: when your balance falls below the amount set on the <B>Balance</B> card (0.0001 ICP unless you change it), you get one free message on Sneed SMS and your urgent channels. It comes again after a top-up. Set it to 0 to turn it off.</Li>
                    <Li><B>Daily spending cap for this app</B>: skipped once the app's cap for today is used up.</Li>
                    <Li><B>Sponsored messages</B>: an app may pay for a message itself from its own balance. Then nothing is taken from yours.</Li>
                    <Li><B>Failed deliveries</B>: if a delivery finally fails, its price goes back to whoever paid.</Li>
                </List>
                <Steps>
                    <Li>Make sure your Sneed Hub <L to="/wallet">wallet</L> has some ICP.</Li>
                    <Li>On the <B>Balance</B> card, type an amount in ICP and press <B>Top up</B>.</Li>
                    <Li>The site approves the notification canister to take that amount on the ICP ledger and then moves it to your balance. The 0.0001 ICP ledger fee comes on top.</Li>
                </Steps>
                <P>
                    <B>What you don't use stays yours.</B> On the same card, <B>Withdraw all to my wallet</B> sends your whole balance back to
                    your Sneed Hub wallet, less the 0.0001 ICP ledger fee. Under <B>Advanced</B> you can withdraw part of it, or send it to
                    another principal. If the ledger doesn't answer, the withdrawal waits and is retried automatically; it goes out at most
                    once. Top-ups and withdrawals are public records tied to your principal.
                </P>
                <Tip title="Top up small amounts">
                    Your balance only pays for deliveries on paid channels. A balance at or below the ledger fee is too small to withdraw,
                    but you can still spend it.
                </Tip>
            </Section>

            <Section icon={FaHistory} title="Recent: your history" id="history">
                <P>
                    The <B>Recent</B> card lists your latest 30 messages with the title, the app, the level, the time and an excerpt of the
                    body. Under each one, a small badge per channel shows what happened:
                </P>
                <List>
                    <Li><B>queued</B> or <B>sending</B>: waiting for delivery (for example during quiet hours).</Li>
                    <Li><B>delivered</B>: it arrived.</Li>
                    <Li><B>suppressed</B>: skipped, with the reason (not enough balance, or the daily spending cap).</Li>
                    <Li><B>failed</B>: the relay gave up after several attempts, with the reason.</Li>
                </List>
                <P>
                    <B>not delivered (muted or no channel)</B> means the message had nowhere to go, for example because you paused
                    everything and set <B>Always copy to</B> to Nothing. Old messages are removed from history after about 30 days.
                </P>
            </Section>

            <Section icon={FaShieldAlt} title="Good to know" id="safety">
                <List>
                    <Li>Apps only reach you if you allowed them, and each one is limited by your daily message and spending caps.</Li>
                    <Li>A repeated message from the same app may be folded into one within an hour, so you aren't flooded.</Li>
                    <Li>Your settings belong to the principal you are logged in with. Logging in with another identity gives you a separate set.</Li>
                    <Li>Codes and messages come from <Code>Sneed Notifications</Code>. If you get a code you didn't ask for, ignore it.</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/monitor', label: 'Sneed Monitor', text: 'proposals to vote on, while Sneed Hub is closed' },
                { to: '/help/app', label: 'Install the app', text: 'needed for push on iPhone' },
                { to: '/help/wallet', label: 'Wallet', text: 'where top-ups come from' },
                { to: '/sms', label: 'Sneed SMS', text: 'your notification inbox' },
                { to: '/forum', label: 'Forum', text: 'replies, mentions and tips' },
            ]} />
        </HelpPage>
    );
}
