// /help/names: identity on Sneed Hub — login, your principal, public names, nicknames,
// verified names, avatars (incl. NFT avatars), accounts and hotkeys, profiles and settings.
import React from 'react';
import {
    FaIdCard, FaBook, FaSignInAlt, FaUser, FaUserTag, FaAddressBook, FaCheckCircle, FaImage,
    FaUsers, FaSearch, FaCog, FaKey, FaUserCircle, FaShieldAlt,
} from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpNames() {
    return (
        <HelpPage
            icon={FaIdCard}
            badgeIcon={FaBook}
            badge="Identity"
            title="Names, Profiles and Settings"
            subtitle="How you sign in, what your principal is, how public names and private nicknames work, avatars, profile pages and your personal settings."
            color="#14b8a6"
            secondary="#0d9488"
        >
            <Section icon={FaSignInAlt} title="Logging in and out" id="login">
                <P>
                    Sneed Hub uses <B>Internet Identity</B> to sign you in. There is no password or e-mail: you sign in with a passkey
                    (your device, a security key or a password manager) through Internet Identity.
                </P>
                <Steps>
                    <Li>Click the <B>Login</B> button (the sign-in arrow at the top right of the header), or open <L to="/login">/login</L>.</Li>
                    <Li>Choose <B>Internet Identity 1.0</B> (the classic interface at identity.ic0.app, for existing anchors and passkeys) or <B>Internet Identity 2.0</B> (the new interface at id.ai).</Li>
                    <Li>Approve the sign-in in the Internet Identity window. If you have no identity yet, use <B>Create on II 1.0</B> or <B>Create on II 2.0</B> at the bottom of the login dialog.</Li>
                    <Li>After signing in from <Code>/login</Code> you are taken to the Hub (or back to the page that sent you there).</Li>
                </Steps>
                <P>
                    A session lasts up to 7 days. To end it, click your principal box at the top right of the header and press <B>Log Out</B> at the bottom of the panel.
                </P>
                <Tip title="Installed app">
                    If you installed Sneed Hub as an app and the login does not come back to the app, the login dialog offers to pair the app with a browser.
                </Tip>
            </Section>

            <Section icon={FaKey} title="Your principal" id="principal">
                <P>
                    Your <B>principal</B> is your public ID on the Internet Computer. It is what holds your tokens, owns your neurons and canisters,
                    and signs your posts, votes and messages. Internet Identity gives you a different principal for every site, so your Sneed Hub principal
                    is not the same as the one you have on another dapp.
                </P>
                <List>
                    <Li>Open the principal box in the header to see your principal and copy it (it can also switch to showing your <B>Account ID</B>).</Li>
                    <Li>Principals are public. Anyone can look at what a principal holds and what it did on-chain. Setting a name does not change that, and not setting one does not make you anonymous.</Li>
                    <Li>Anywhere a principal is shown you can right-click it (long-press on a phone) for <B>Send Message</B>, <B>Set Nickname</B> / <B>Edit Nickname</B>, <B>View Profile</B> and <B>Copy Principal ID</B>.</Li>
                </List>
            </Section>

            <Section icon={FaUserTag} title="Public names and private nicknames" id="names-vs-nicknames">
                <P>Sneed Hub has two kinds of names, and it is worth keeping them apart:</P>
                <List>
                    <Li>
                        A <B>public name</B> is shown to everyone, everywhere the principal, neuron or canister appears: forum posts, offers, proposals,
                        the principal picker. Only the owner can set it: you name your own principal, a neuron&apos;s owner or hotkeys name the neuron,
                        and a canister&apos;s controllers name the canister.
                    </Li>
                    <Li>
                        A <B>nickname</B> is your own label for a principal or neuron (like a contact in an address book). You can give any principal or neuron a nickname,
                        and it is shown only to you on Sneed Hub. Where both exist you see both.
                    </Li>
                </List>
                <Sub>Rules for names and nicknames</Sub>
                <List>
                    <Li>1 to 32 characters (2 to 32 for canister names).</Li>
                    <Li>Only letters a-z and A-Z, digits, spaces, hyphens (-), underscores (_), dots (.) and apostrophes (&apos;); at least one letter or digit; no space at the start or end and no two spaces in a row.</Li>
                    <Li>Public names are unique, and capital letters do not count as a difference: if someone has &quot;Sneed Whale&quot;, nobody else can take &quot;sneed whale&quot;. Neuron names only need to be unique within their SNS.</Li>
                    <Li>Setting or changing a name costs nothing; you only need to be logged in.</Li>
                    <Li>You can have up to 10 principal nicknames and 10 neuron nicknames for free, and up to 100 of each with <L to="/premium">Sneed Premium</L>.</Li>
                </List>
                <Warning title="Moderation">
                    Names are checked against a list of blocked words. A <B>public name</B> with a blocked word is refused and gets you banned automatically;
                    a nickname with one is simply refused. Banned users cannot set names until the ban ends.
                </Warning>
                <Info title="How private is a nickname?">
                    Nicknames are not shown to other users, and when you @-mention someone the post shows their public name, never your nickname.
                    They are still stored on-chain in Sneed&apos;s naming canisters, so do not put anything secret in a nickname.
                </Info>
            </Section>

            <Section icon={FaUser} title="Setting your public name" id="set-name">
                <Steps>
                    <Li>Log in and open <L to="/me">Me</L> (your profile page).</Li>
                    <Li>Click <B>Set Display Name</B> (or <B>Change Display Name</B> if you already have one).</Li>
                    <Li>Type the name (max 32 characters) and press <B>Save</B>.</Li>
                    <Li>Confirm the dialog. It reminds you that the name is visible to everyone and that inappropriate names can result in a ban.</Li>
                </Steps>
                <P>
                    You can also do this from your own public profile page with <B>Set Name</B> / <B>Change Name</B>.
                </P>
                <Sub>Naming neurons and canisters</Sub>
                <List>
                    <Li><B>Neurons:</B> on <L to="/me">Me</L>, your neurons for the selected SNS are listed. If your principal has a permission on a neuron (owner or hotkey) the edit button sets its public name; otherwise it sets your private nickname. Names are per SNS.</Li>
                    <Li><B>Canisters:</B> on a canister&apos;s page the <B>Public Name</B> field can be edited by the canister&apos;s controllers (an SNS can name canisters it controls by proposal). Anyone can give a canister a nickname.</Li>
                </List>
            </Section>

            <Section icon={FaCheckCircle} title="Verified names" id="verified">
                <P>
                    A <B>verified</B> name has a checkmark next to it. The checkmark is given by Sneed admins or by a Sneed DAO proposal, to confirm that a well-known
                    name really belongs to that principal, neuron or canister. You cannot verify your own name.
                </P>
                <List>
                    <Li>The checkmark is tied to the exact name. If you change a verified principal or canister name, the checkmark goes away.</Li>
                    <Li>A name without a checkmark is just what its owner chose. When sending tokens to a named principal, check the principal itself too.</Li>
                </List>
            </Section>

            <Section icon={FaAddressBook} title="Your address book (/names)" id="address-book">
                <P>
                    The <L to="/names">Address Book</L> page (also <B>My Contacts</B> on Me) lists all your private nicknames. It needs you to be logged in.
                </P>
                <List>
                    <Li><B>Principal Nicknames:</B> pick a principal with the principal picker, type a <B>Nickname</B> and press <B>Add</B>. Search by principal, public name or nickname; edit or remove entries with the buttons on each row.</Li>
                    <Li><B>Neuron Nicknames:</B> the same for neurons. These are scoped to the SNS selected in the header, so switch the SNS to see another DAO&apos;s neuron nicknames.</Li>
                </List>
                <Tip>
                    You can also set a nickname right where you see someone: right-click (or long-press) their principal and choose <B>Set Nickname</B>, or use <B>Set Nickname</B> on their profile page.
                </Tip>
            </Section>

            <Section icon={FaSearch} title="The principal picker" id="principal-input">
                <P>
                    Wherever Sneed Hub asks for a principal (sending tokens, adding hotkeys, inviting people, the address book) you get the same input box with
                    auto-complete. Type part of a name or nickname, or paste a full principal ID.
                </P>
                <List>
                    <Li><B>Private</B> searches only your nicknames, <B>Public</B> only public names, and <B>All</B> both.</Li>
                    <Li>The user and canister toggles (<B>Show users</B>, <B>Show canisters</B>) narrow the list to people or to canisters.</Li>
                    <Li>Results show the avatar, name, nickname and checkmark, so you can tell look-alike names apart before you pick one.</Li>
                </List>
            </Section>

            <Section icon={FaImage} title="Avatars and NFT avatars" id="avatars">
                <P>
                    Your avatar is shown next to your name across Sneed Hub: forum posts, offers, the principal picker and your profile.
                </P>
                <Steps>
                    <Li>On <L to="/me">Me</L>, click the small camera button on your profile picture.</Li>
                    <Li>Either <B>Upload picture…</B> (it is shrunk to a small square and stored on-chain) or paste an <Code>https://</Code> link to an image you host (up to 512 characters).</Li>
                    <Li>Check the preview and press <B>Save avatar</B>. <B>Remove avatar</B> clears it.</Li>
                </Steps>
                <Sub>Using an NFT you own</Sub>
                <P>
                    You can also show an ICRC-7 NFT you own as your avatar. In the avatar editor press <B>Use an NFT I own…</B> and pick one from the collections in
                    your <L to="/nft">NFT wallet</L>, or open any NFT you own and choose <B>Use as my avatar</B>.
                </P>
                <List>
                    <Li>Ownership is checked when you set it: one of your account&apos;s principals must own the NFT.</Li>
                    <Li>It is checked again whenever the avatar is shown. If you sell or send the NFT away, it stops showing and your normal picture shows instead.</Li>
                    <Li><B>Stop showing the NFT</B> goes back to your normal picture.</Li>
                </List>
            </Section>

            <Section icon={FaUsers} title="Your account: one name for several principals" id="account">
                <P>
                    Because Internet Identity gives you a different principal on every dapp, the <B>Your account</B> panel on <L to="/me">Me</L> lets you put
                    several principals in one account so they all show the same name and avatar. You get an account automatically when you set a name or an avatar.
                </P>
                <List>
                    <Li><B>Hotkeys:</B> give another principal a hotkey with <B>Add hotkey</B>. A hotkey can rename your account, change its avatar, and merge it into its own account. Hotkeys are not shown as your principals.</Li>
                    <Li><B>Accounts you hold a hotkey on</B> are listed below; you can <B>Rename</B> them or press <B>Merge into my account</B>, after which their principals show your account&apos;s name.</Li>
                    <Li>Owners can change roles (<B>Make owner</B> / <B>Make member</B>), remove principals, and label which dapp each principal is used on. Any principal can <B>Leave</B>.</Li>
                    <Li>An account holds up to 50 principals and 10 hotkeys.</Li>
                </List>
                <Warning title="Linking is public">
                    Principals in one account are shown together, so everyone can see they belong to the same person. Only link principals you are happy to have connected in public.
                </Warning>
            </Section>

            <Section icon={FaUserCircle} title="Profile pages: /me, /user and /users" id="profiles">
                <Sub>Me</Sub>
                <P>
                    <L to="/me">Me</L> is your own dashboard: your name, avatar, Premium badge, post/thread/tip counts, quick links (<B>My Wallet</B>, <B>My Apps</B>,
                    <B> Voting</B>, <B>My Trades</B>, <B>My Posts</B>, <B>My Tips</B>, <B>My Messages</B>, <B>My Rewards</B>, <B>My Locks</B>, <B>My Contacts</B>),
                    your neurons, and your settings. <B>View My Public Page</B> opens what others see.
                </P>
                <Sub>Public profile pages</Sub>
                <P>
                    Every principal has a public page (<Code>/user?id=…</Code> for people; canisters open their canister page). It shows the name, nickname,
                    checkmark and counts, with tabs for <B>Posts &amp; Threads</B>, <B>Trades</B>, <B>Neurons</B>, <B>Transactions</B> and <B>Wallet</B>.
                    When logged in you can <B>Set Nickname</B> and <B>Send Message</B> from there. Share the link to let others find you.
                </P>
                <Sub>User Explorer</Sub>
                <P>
                    <L to="/users">Users</L> lists every principal with a public name or one of your nicknames. Filter by text, choose <B>Both</B>,
                    <B> Public names only</B> or <B>Nicknames only</B>, or use the search box at the top to jump to any principal. Canisters are listed
                    on <L to="/canisters">Canisters</L>.
                </P>
            </Section>

            <Section icon={FaCog} title="Your settings" id="settings">
                <P>Settings are on <L to="/me">Me</L>, in collapsible sections:</P>
                <List>
                    <Li><B>General Settings:</B> Theme (dark or light), <B>Denomination Currency</B>, principal and neuron colour coding, the voting power bar, quick links on desktop, particle effects, always showing the remove button on wallet tokens, and how app updates are detected and applied (auto-update, clear cache, check interval, countdown).</Li>
                    <Li><B>Notification Bar Settings:</B> what the header notification bar shows (replies, tips, messages, collectibles and their threshold, votable proposals, outdated bots, low cycles, bot health and log errors or warnings, app updates) and <B>SMS When Mentioned</B>.</Li>
                    <Li><B>ICP Staking Bot Settings</B> and <B>App Manager Settings:</B> cycle warning thresholds for your bots and apps.</Li>
                    <Li><B>Sneedex:</B> default swap slippage and which Sneedex events you get a direct message about (new bids, outbid, sold, won, expired, cancelled, private auction invites). Press <B>Save Settings</B>.</Li>
                    <Li><B>Cache Management:</B> <B>Clear All Caches</B>, or the stronger <B>Completely Clear All Site Data</B> if the site misbehaves.</Li>
                </List>
                <Sub>Denominate in anything</Sub>
                <P>
                    Values across Sneed Hub (wallet totals, prices of offers, rewards) are shown in a currency you choose. Pick any token with
                    <B> Denomination Currency</B> on Me, or with <B>Currency</B> in the header menu. The default is USD (ck-USDC); the small reset button goes back to it.
                    When logged in, your choice is saved with your settings so it follows you to other devices.
                </P>
                <P>
                    The theme can also be switched from the header menu. Settings like the notification choices are saved with your principal; some display choices are kept in this browser only.
                </P>
            </Section>

            <Section icon={FaShieldAlt} title="Safety notes" id="safety">
                <List>
                    <Li>Names and checkmarks help, but the principal is what counts. Before sending tokens, compare the principal (or at least its start and end).</Li>
                    <Li>Anyone can pick a name that looks like someone else&apos;s. A checkmark is the only sign that Sneed has confirmed it.</Li>
                    <Li>Public names, avatars and linked accounts are public and stored on-chain. Choose what you share accordingly.</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/wallet', label: 'Wallet', text: 'tokens, NFTs and sending to principals' },
                { to: '/help/forum', label: 'Forum', text: 'posts, mentions and tips' },
                { to: '/help/sms', label: 'Sneed SMS', text: 'direct messages' },
                { to: '/help/notifications', label: 'Notifications', text: 'what the header bar shows' },
                { to: '/help/neurons', label: 'Neurons', text: 'neuron names and hotkeys' },
            ]} />
        </HelpPage>
    );
}
