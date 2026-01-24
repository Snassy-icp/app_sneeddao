import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Login from './Login';
import Wallet from './Wallet';
import Doc from './Doc';
import Help from './Help';
import Dashboard from './Dashboard';
import TokenLock from './TokenLock';
import PositionLock from './PositionLock';
import Lock from './Lock';
import TokenLocksOverview from './TokenLocksOverview';
import RLL from './RLL';
import RLLInfo from './RLLInfo';
import ScanWallet from './ScanWallet';
import Neuron from './Neuron';
import Proposal from './Proposal';
import { AuthProvider } from './AuthContext';
import { NamingProvider, useNaming } from './NamingContext';
import { SnsProvider } from './contexts/SnsContext';
import { ForumProvider } from './contexts/ForumContext';
import { NeuronsProvider } from './contexts/NeuronsContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';

// Import new pages
import Dao from './pages/Dao';
import DaoInfo from './pages/DaoInfo';
import Me from './pages/Me';
import MeInfo from './pages/MeInfo';
import Names from './pages/Names';
import Tokenomics from './pages/Tokenomics';
import TokenomicsInfo from './pages/TokenomicsInfo';
import Sneedlock from './pages/Sneedlock';
import SneedlockInfo from './pages/SneedlockInfo';
import Products from './pages/Products';
import Partners from './pages/Partners';
import Proposals from './pages/Proposals';
import Admin from './pages/Admin';
import UserBans from './pages/admin/UserBans';
import WordBlacklist from './pages/admin/WordBlacklist';
import AdminPartners from './pages/admin/Partners';
import AdminProjects from './pages/admin/Projects';
import AdminNames from './pages/AdminNames';
import AdminForum from './pages/admin/Forum';
import SmsAdmin from './pages/SmsAdmin';
import SneedLockAdmin from './pages/admin/SneedLock';
import IcpNeuronManagerFactoryAdmin from './pages/admin/IcpNeuronManagerFactory';
import SneedexAdmin from './pages/admin/Sneedex';
import SneedPremiumAdmin from './pages/admin/SneedPremium';
import CanisterGroupsAdmin from './pages/admin/CanisterGroups';
import Projects from './pages/Projects';
import Rewards from './pages/Rewards';
import Disclaimer from './pages/Disclaimer';
import Principal from './pages/Principal';
import Neurons from './pages/Neurons';
import Transaction from './pages/Transaction';
import Transactions from './pages/Transactions';
import Hub from './pages/Hub';
import ToolsMain from './pages/ToolsMain';
import ToolsEscrow from './pages/ToolsEscrow';
import EscrowSwap from './pages/EscrowSwap';
import Tips from './pages/Tips';
import Posts from './pages/Posts';
import SMS from './pages/SMS';
import Message from './pages/Message';
import Thread from './pages/Thread';
import Post from './pages/Post';
import Forum from './pages/Forum';
import Feed from './pages/Feed';
import Topic from './pages/Topic';
import HelpNeurons from './pages/HelpNeurons';
import HelpWallet from './pages/HelpWallet';
import HelpSneedlock from './pages/HelpSneedlock';
import HelpIcpNeuronManager from './pages/HelpIcpNeuronManager';
import HelpSneedex from './pages/HelpSneedex';
import HelpCanisterManager from './pages/HelpCanisterManager';
import Canister from './pages/Canister';
import Canisters from './pages/Canisters';
import CreateIcpNeuron from './pages/CreateIcpNeuron';
import IcpNeuronManager from './pages/IcpNeuronManager';
import LockWizard from './pages/LockWizard';

// Sneedex pages
import Sneedex from './pages/Sneedex';
import SneedexOffers from './pages/SneedexOffers';
import SneedexOffer from './pages/SneedexOffer';
import SneedexCreate from './pages/SneedexCreate';
import SneedexMy from './pages/SneedexMy';

// Premium page
import Premium from './pages/Premium';

// Component to set up global naming function
function GlobalNamingSetup() {
    const { getNeuronDisplayName } = useNaming();
    
    React.useEffect(() => {
        window.getNeuronDisplayName = getNeuronDisplayName;
        return () => {
            delete window.getNeuronDisplayName;
        };
    }, [getNeuronDisplayName]);
    
    return null;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SnsProvider>
          <NeuronsProvider>
            <ForumProvider>
              <Router>
                <NamingProvider>
                  <GlobalNamingSetup />
                  <Layout>
                  <Routes>
                    <Route path="/" element={<Feed />} />
                    <Route path="/wallet" element={<Wallet />} />
                    <Route path="/doc" element={<Doc />} />
                    <Route path="/help" element={<Help />} />
                    <Route path="/help/neurons" element={<HelpNeurons />} />
                    <Route path="/help/wallet" element={<HelpWallet />} />
                    <Route path="/help/sneedlock" element={<HelpSneedlock />} />
                    <Route path="/help/icp-neuron-manager" element={<HelpIcpNeuronManager />} />
                    <Route path="/help/sneedex" element={<HelpSneedex />} />
                    <Route path="/help/canister-manager" element={<HelpCanisterManager />} />
                    <Route path="/rll" element={<RLL />} />
                    <Route path="/rll_info" element={<RLLInfo />} />
                    <Route path="/scan_wallet" element={<ScanWallet />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/tokenlock" element={<TokenLock />} />
                    <Route path="/positionlock" element={<PositionLock />} />
                    <Route path="/lock/:id" element={<Lock />} />
                    <Route path="/tokenlocksoverview" element={<TokenLocksOverview />} />
                    <Route path="/neuron" element={<Neuron />} />
                    <Route path="/proposal" element={<Proposal />} />

                    {/* New routes */}
                    <Route path="/dao" element={<Dao />} />
                    <Route path="/dao_info" element={<DaoInfo />} />
                    <Route path="/me" element={<Me />} />
                    <Route path="/names" element={<Names />} />
                    <Route path="/me_info" element={<MeInfo />} />
                    <Route path="/tokenomics" element={<Tokenomics />} />
                    <Route path="/tokenomics_info" element={<TokenomicsInfo />} />
                    <Route path="/sneedlock" element={<Sneedlock />} />
                    <Route path="/sneedlock_info" element={<SneedlockInfo />} />
                    <Route path="/lock_wizard" element={<LockWizard />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/partners" element={<Partners />} />
                    <Route path="/projects" element={<Projects />} />
                    <Route path="/proposals" element={<Proposals />} />
                    <Route path="/premium" element={<Premium />} />
                    <Route path="/rewards" element={<Rewards />} />
                    <Route path="/tips" element={<Tips />} />
                    <Route path="/posts" element={<Posts />} />
                    <Route path="/sms" element={<SMS />} />
                    <Route path="/msg/:id" element={<Message />} />
                    <Route path="/thread" element={<Thread />} />
                    <Route path="/post" element={<Post />} />
                    <Route path="/disclaimer" element={<Disclaimer />} />
                    <Route path="/principal" element={<Principal />} />
                    <Route path="/canister" element={<Canister />} />
                    <Route path="/canisters" element={<Canisters />} />
                    <Route path="/neurons" element={<Neurons />} />
                    <Route path="/create_icp_neuron" element={<CreateIcpNeuron />} />
                    <Route path="/icp_neuron_manager/:canisterId" element={<IcpNeuronManager />} />
                    <Route path="/transaction" element={<Transaction />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/hub" element={<Hub />} />

                    {/* Forum routes */}
                    <Route path="/forum" element={<Forum />} />
                    <Route path="/feed" element={<Feed />} />
                    <Route path="/topic/:topicId" element={<Topic />} />

                    {/* Tools routes */}
                    <Route path="/tools/main" element={<ToolsMain />} />
                    <Route path="/tools/escrow" element={<ToolsEscrow />} />
                    <Route path="/tools/escrow/swap" element={<EscrowSwap />} />

                    {/* Sneedex routes */}
                    <Route path="/sneedex" element={<Sneedex />} />
                    <Route path="/sneedex_offers" element={<SneedexOffers />} />
                    <Route path="/sneedex_offer/:id" element={<SneedexOffer />} />
                    <Route path="/sneedex_create" element={<SneedexCreate />} />
                    <Route path="/sneedex_my" element={<SneedexMy />} />

                    {/* Admin routes */}
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/admin/users/bans" element={<UserBans />} />
                    <Route path="/admin/words" element={<WordBlacklist />} />
                    <Route path="/admin/partners" element={<AdminPartners />} />
                    <Route path="/admin/projects" element={<AdminProjects />} />
                    <Route path="/admin/names" element={<AdminNames />} />
                    <Route path="/admin/forum" element={<AdminForum />} />
                    <Route path="/admin/sms" element={<SmsAdmin />} />
                    <Route path="/admin/sneedlock" element={<SneedLockAdmin />} />
                    <Route path="/admin/neuron-manager-factory" element={<IcpNeuronManagerFactoryAdmin />} />
                    <Route path="/admin/sneedex" element={<SneedexAdmin />} />
                    <Route path="/admin/premium" element={<SneedPremiumAdmin />} />
                    <Route path="/admin/canisters" element={<CanisterGroupsAdmin />} />
                  </Routes>
                  </Layout>
                </NamingProvider>
              </Router>
            </ForumProvider>
          </NeuronsProvider>
        </SnsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;