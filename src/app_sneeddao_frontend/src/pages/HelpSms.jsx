// /help/sms: Sneed SMS direct messages (/sms, /msg/:id).
import React from 'react';
import { FaEnvelope, FaBook, FaPaperPlane, FaReply, FaInbox, FaLock, FaStar, FaTrash, FaBell } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpSms() {
    return (
        <HelpPage
            icon={FaEnvelope}
            badgeIcon={FaBook}
            badge="Community"
            title="Sneed SMS Messages"
            subtitle="Send direct messages from your principal to anyone on the Internet Computer: compose, reply, follow a conversation as a thread, and know who can read what."
            color="#ec4899"
            secondary="#f472b6"
        >
            <Section icon={FaEnvelope} title="What it is" id="overview">
                <P>
                    Sneed SMS is a direct-messaging canister. A message goes from your principal to one
                    or more recipient principals and has a subject and a body. You read and write them on
                    the <L to="/sms">Messages</L> page, which you can also reach from the header and from your <L to="/me">Me</L> page.
                </P>
                <P>
                    Besides messages from other people, your inbox can also hold messages sent by Sneed apps, for example
                    Sneedex auction alerts you chose on your Me page, and mention alerts from the forum if you opted in.
                </P>
            </Section>

            <Section icon={FaLock} title="Who can read your messages" id="privacy">
                <P>
                    Messages are not posted publicly, but they are not end-to-end encrypted either. Be clear about what that means:
                </P>
                <List>
                    <Li>The subject and body are stored as plain text in the Sneed SMS canister, together with the sender's and recipients' principals.</Li>
                    <Li>The canister only hands a message to its sender and its recipients. Other users can't read it through the app.</Li>
                    <Li>Sneed SMS admins can read all messages through an admin view. The admins include the Sneed DAO's governance canister and the canister's controllers.</Li>
                    <Li>As with any canister data, the nodes of the subnet that hosts the canister hold its state.</Li>
                    <Li>Every recipient sees all other recipients of the same message.</Li>
                </List>
                <Warning title="Not for secrets">
                    Never send seed phrases, passwords, private keys or anything else you couldn't afford to have read. Treat
                    Sneed SMS like ordinary email, not like an encrypted messenger.
                </Warning>
            </Section>

            <Section icon={FaPaperPlane} title="Sending a message" id="send">
                <Steps>
                    <Li>Log in and open <L to="/sms">Messages</L>.</Li>
                    <Li>Press <B>Compose</B>.</Li>
                    <Li>Under <B>Recipients</B>, enter a principal ID or search by Sneed name or your nickname for someone. Use <B>Add Recipient</B> for more people and the trash icon to remove one.</Li>
                    <Li>Enter a <B>Subject</B> and the <B>Message</B>. The body supports Markdown and emoji, with formatting buttons above it. Counters show how many characters you have left.</Li>
                    <Li>Press <B>Send Message</B>.</Li>
                </Steps>
                <P>
                    You can also start a message from other places: the <B>Send Message</B> button on a user's page
                    (open one via <L to="/principal">Principal</L>) or the envelope button on a forum post
                    (<B>Send a private message to the post author</B>). Both open the same compose dialog with the recipient
                    filled in.
                </P>
                <Info title="Sending is free">
                    Sending a message costs you nothing; there's no token fee. You do need to be logged in, since messages from
                    the anonymous principal are refused.
                </Info>
            </Section>

            <Section icon={FaStar} title="Limits and Premium" id="limits">
                <P>The canister enforces limits on every message. The defaults are:</P>
                <List>
                    <Li>Subject: up to 200 characters. Body: up to 5,000 characters. Neither can be empty.</Li>
                    <Li>Up to 20 recipients per message.</Li>
                    <Li>One message every 10 minutes. If you send sooner you get a <B>Rate Limited</B> error that tells you how long to wait.</Li>
                </List>
                <P>
                    Members of <L to="/premium">Sneed Premium</L> get higher limits, by default a 500-character subject, a 20,000-character
                    body, 50 recipients and one message per minute. The compose dialog marks the raised limits with
                    a <B>PREMIUM</B> badge. Admins can change all of these numbers, and the dialog always shows the limits that apply to you.
                </P>
                <Tip title="Mention alerts use your allowance">
                    When you @-mention someone in the forum who opted in to mention SMS, the app sends them an SMS from your
                    principal. That counts as one of your messages for the rate limit.
                </Tip>
            </Section>

            <Section icon={FaInbox} title="Reading messages" id="inbox">
                <List>
                    <Li>The tabs <B>Inbox</B>, <B>Sent</B> and <B>All</B> filter your messages. The header shows how many you have received and sent; press <B>Refresh</B> to reload.</Li>
                    <Li>Messages that arrived since your last visit are highlighted as <B>New</B>. When you open the page, they count as seen.</Li>
                    <Li>Click a message to open it. <B>Message Details</B> shows the subject, sender (<B>From</B>), all recipients (<B>To</B>) and the date, with buttons to copy principals.</Li>
                </List>
            </Section>

            <Section icon={FaReply} title="Replies and threads" id="replies">
                <List>
                    <Li><B>Reply</B> answers only the sender. <B>Reply All</B> answers the sender and every other recipient, without you. Both keep the subject with <Code>Re:</Code> in front.</Li>
                    <Li>A reply is linked to the message it answers. You can only reply to messages you have access to.</Li>
                    <Li>Press <B>Thread</B> on a message to open the conversation view. It shows the message with the messages it answers above and the replies to it below, nested. Use <B>Expand All</B> and <B>Collapse All</B>, collapse single messages, and load earlier context as you go.</Li>
                </List>
            </Section>

            <Section icon={FaTrash} title="Removing a message" id="remove">
                <P>
                    In an open message, <B>Remove</B> takes you off that message: it disappears from your lists and you can no longer
                    open it. It asks for confirmation first and can't be undone.
                </P>
                <List>
                    <Li>The message stays for the other people on it. If the sender removes themselves, the others see the anonymous principal as sender.</Li>
                    <Li>When the last person removes themselves, the message is deleted from the canister.</Li>
                    <Li>Removing only affects your own copy. You can't take back a message from other people's inboxes.</Li>
                </List>
            </Section>

            <Section icon={FaBell} title="Notifications" id="notifications">
                <List>
                    <Li>The header shows a counter for new messages. Click it to open <L to="/sms">Messages</L>. Turn it on or off with <B>Message Notifications</B> in the settings on your <L to="/me">Me</L> page.</Li>
                    <Li><B>SMS When Mentioned</B>, also on your Me page, decides whether forum @-mentions reach you as an SMS. See <L to="/help/forum">Forum help</L>.</Li>
                    <Li>On your Me page you can also choose which Sneedex events reach you by direct message.</Li>
                    <Li>
                        You can also get a heads-up on your phone or Discord when a new message arrives: allow Sneed Hub and add a channel
                        on <L to="/notifications">Notifications</L>. It says who it's from and shows the subject, <B>never the message text</B>.
                    </Li>
                    <Li>For alerts beyond Sneed Hub itself, see <L to="/notifications">Notifications</L> and its <L to="/help/notifications">help page</L>.</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/forum', label: 'Forum, Feed and Tips', text: 'public discussions, mentions and tips' },
                { to: '/help/notifications', label: 'Notifications', text: 'where alerts can reach you' },
                { to: '/premium', label: 'Sneed Premium', text: 'higher message limits' },
            ]} />
        </HelpPage>
    );
}
