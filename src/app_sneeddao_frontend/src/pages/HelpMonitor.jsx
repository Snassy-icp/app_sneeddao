// /help/monitor: Sneed Monitor (sneed_mon, spec/sneed_mon.md), set up on /notifications.
import React, { useEffect, useState } from 'react';
import { FaSatelliteDish, FaBook, FaToggleOn, FaCoins, FaSlidersH, FaStopCircle, FaShieldAlt } from 'react-icons/fa';
import { HelpPage, Section, P, List, Steps, Li, B, L, Tip, Info, Warning, Related } from './HelpLayout';
import { monEnabled, monActor, tierLabel, fmtIcp } from '../utils/SneedMonService';

// the default table (spec §3); the live one replaces it where the canister exists
const DEFAULT_TIERS = [[10, 6_000n, 864_000n], [60, 18_000n, 432_000n], [180, 36_000n, 288_000n], [1440, 144_000n, 144_000n]];

export default function HelpMonitor() {
    const [tiers, setTiers] = useState(DEFAULT_TIERS);
    useEffect(() => {
        if (!monEnabled) return;
        monActor(null).get_tiers().then((t) => setTiers(t.tiers.map((x) => [Number(x.every_min), x.per_check_e8s, x.daily_price_e8s]))).catch(() => {});
    }, []);
    return (
        <HelpPage
            icon={FaSatelliteDish}
            badgeIcon={FaBook}
            badge="Governance"
            title="Sneed Monitor"
            subtitle="A message when one of your neurons can vote on a proposal, and a reminder before voting closes, even while Sneed Hub is closed."
            color="#f59e0b"
            secondary="#fbbf24"
        >
            <Section icon={FaSatelliteDish} title="What it is" id="overview">
                <P>
                    Sneed Hub's header shows proposals you can vote on, but only while the site is open. Sneed Monitor is a canister that
                    keeps watching for you. It checks the SNSes (and the NNS) you choose and sends you a message through
                    {' '}<L to="/help/notifications">Sneed Notifications</L> when a proposal comes up that one of your neurons can vote on and hasn't.
                    Messages land in your Sneed SMS inbox and on any other channel you set up there, such as your phone or Discord.
                </P>
                <List>
                    <Li><B>SNS</B>: a neuron counts when it gives you the vote permission (as a hotkey, for example) and has a ballot on the proposal that is not cast yet.</Li>
                    <Li><B>NNS</B>: the NNS shows a neuron's ballots only to its owner, so you register your NNS neuron ids and Sneed Monitor reads their public information. No hotkey is needed. A private neuron hides its ballots, so it only counts for new-proposal messages, not reminders.</Li>
                    <Li><B>Reminders</B>: if your neurons still haven't voted when the deadline comes close (a day before, unless you change it), you get one more message, marked urgent.</Li>
                </List>
            </Section>

            <Section icon={FaToggleOn} title="Turning it on" id="start">
                <Steps>
                    <Li>Log in and open <L to="/notifications">Notifications</L>. Find the <B>Sneed Monitor</B> card.</Li>
                    <Li>Turn on <B>Tell me about proposals I can vote on</B>. It watches every SNS where Sneed Hub found neurons you can vote with, and the NNS if it knows your NNS neurons, checking each hourly.</Li>
                    <Li>If your Sneed Monitor balance is too low, a top-up step opens. Press <B>Top up from my wallet</B>, or send ICP to the deposit address shown and press <B>I've sent it: check deposit</B>. Monitoring turns on as soon as the ICP is credited.</Li>
                    <Li>Sneed Monitor is also allowed to notify you in Sneed Notifications, unless you allowed it already.</Li>
                </Steps>
                <P>The card shows your balance and what your current setup costs a month, in ICP and in your chosen currency.</P>
                <Info title="Your neurons load in the background">
                    Right after you log in, Sneed Hub may still be finding your neurons. If the card says it found none, wait a moment, or add an SNS yourself under <B>Advanced</B>.
                </Info>
            </Section>

            <Section icon={FaCoins} title="Prices" id="pricing">
                <P>
                    You pay per check of each watch, from a prepaid ICP balance held by Sneed Monitor. A check that finds nothing still
                    costs the same: you pay for being watched. The price depends on how often a watch is checked:
                </P>
                <List>
                    {tiers.map(([min, perCheck, daily]) => (
                        <Li key={min}><B>{tierLabel(min)}</B>: {fmtIcp(perCheck)} a check, {fmtIcp(daily)} a day, about {fmtIcp(daily * 30n)} a month.</Li>
                    ))}
                </List>
                <P>
                    Hourly is the default. Checking more often means you hear sooner, which matters for short votes. The messages themselves
                    are priced by Sneed Notifications as usual: Sneed SMS is free; phone push and Discord take a small amount from your
                    notification balance there.
                </P>
                <List>
                    <Li><B>Topping up</B>: ICP sent to your deposit address is moved into your balance when you press <B>check deposit</B> (or straight away with <B>Top up from my wallet</B>). Moving it costs one ledger fee (0.0001 ICP).</Li>
                    <Li><B>Topping up automatically</B>: tick <B>Top up automatically from my wallet</B> and choose an amount, the balance that triggers it, and a total allowance with an expiry. Pressing <B>Allow</B> approves Sneed Monitor on the ICP ledger for that allowance only; it can never take more, or anything after the expiry. You can pay from a subaccount holding limited funds. If a top-up fails (allowance used up or expired, wallet empty) you get one message, and it tries again a day later. <B>Turn off</B> stops it and withdraws the allowance.</Li>
                    <Li><B>Running out</B>: when your balance can't pay a check, monitoring pauses. Your watches are kept, nothing more is charged, and you get one message saying so. Topping up resumes it.</Li>
                    <Li><B>Where the money goes</B>: collected fees are forwarded to the Sneed DAO's revenue loop (the same account Sneed Premium pays into).</Li>
                </List>
            </Section>

            <Section icon={FaSlidersH} title="Advanced settings" id="advanced">
                <P>Open <B>Advanced</B> on the Sneed Monitor card to:</P>
                <List>
                    <Li>change how often each watch is checked, with the price of each frequency;</Li>
                    <Li>choose the proposal <B>topics</B> you hear about (for example only Governance), per watch;</Li>
                    <Li>turn new-proposal messages or reminders off, and choose how long before the deadline the reminder comes (1 hour to 2 days, at least the check interval);</Li>
                    <Li>watch another SNS or the NNS yourself, or stop watching one;</Li>
                    <Li>register your NNS neuron ids (Sneed Hub fills in the ones it knows with <B>Use my NNS neurons</B>);</Li>
                    <Li>press <B>Refresh neurons</B> after you add a hotkey to a neuron, so it counts at once instead of within six hours;</Li>
                    <Li>see every charge with what the check found, and withdraw your balance.</Li>
                </List>
                <Tip title="Daily checks">A daily watch may only see a proposal up to a day after it appears. Pick a 2-day reminder window for daily watches, or check more often for SNSes with short votes.</Tip>
            </Section>

            <Section icon={FaStopCircle} title="Stopping and withdrawing" id="stop">
                <Steps>
                    <Li>Turn off <B>Tell me about proposals I can vote on</B> to stop watching everything (or remove single watches under <B>Advanced</B>). Nothing is charged without watches.</Li>
                    <Li>Under <B>Advanced</B> → <B>Balance</B>, enter an amount (or press <B>All</B>) and press <B>Withdraw</B>. It goes to your own wallet unless you choose another principal; the ledger fee comes off the amount.</Li>
                </Steps>
                <P>You can also block Sneed Monitor in Sneed Notifications: then no messages reach you, but checks are still charged while you watch, so stop watching too.</P>
            </Section>

            <Section icon={FaShieldAlt} title="Good to know" id="safety">
                <List>
                    <Li>Sneed Monitor only reads public data: proposals, ballots and neuron information. It never needs a hotkey and cannot vote for you.</Li>
                    <Li>Your watches and balance belong to the principal you are logged in with. They are not published, but not secret either: the canister stores them unencrypted.</Li>
                    <Li>Sneed Monitor can't promise every message arrives: if a message is refused by Sneed Notifications (you blocked the app, or hit your daily cap), that check is still charged.</Li>
                </List>
                <Warning title="Small amounts">Top up what you expect to use for a month or two. Your balance can be withdrawn any time, less the ledger fee.</Warning>
            </Section>

            <Related links={[
                { to: '/help/notifications', label: 'Notifications', text: 'where the messages go' },
                { to: '/help/proposals', label: 'Proposals and Voting', text: 'vote once you are told' },
                { to: '/help/neurons', label: 'SNS Neurons', text: 'hotkeys and permissions' },
                { to: '/help/wallet', label: 'Wallet', text: 'where top-ups come from' },
            ]} />
        </HelpPage>
    );
}
