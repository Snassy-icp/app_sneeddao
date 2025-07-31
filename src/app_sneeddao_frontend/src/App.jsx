import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Login from './Login';
import Wallet from './Wallet';
import Doc from './Doc';
import Help from './Help';
import Dashboard from './Dashboard';
import TokenLock from './TokenLock';
import PositionLock from './PositionLock';
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
import Layout from './components/Layout';

// Import new pages
import Dao from './pages/Dao';
import DaoInfo from './pages/DaoInfo';
import Me from './pages/Me';
import MeInfo from './pages/MeInfo';
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
    <AuthProvider>
      <SnsProvider>
        <NeuronsProvider>
          <ForumProvider>
            <Router>
              <NamingProvider>
                <GlobalNamingSetup />
                <Layout>
                  <Routes>
                    <Route path="/" element={<Login />} />
                    <Route path="/wallet" element={<Wallet />} />
                    <Route path="/doc" element={<Doc />} />
                    <Route path="/help" element={<Help />} />
                    <Route path="/rll" element={<RLL />} />
                    <Route path="/rll_info" element={<RLLInfo />} />
                    <Route path="/scan_wallet" element={<ScanWallet />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/tokenlock" element={<TokenLock />} />
                    <Route path="/positionlock" element={<PositionLock />} />
                    <Route path="/tokenlocksoverview" element={<TokenLocksOverview />} />
                    <Route path="/neuron" element={<Neuron />} />
                    <Route path="/proposal" element={<Proposal />} />

                    {/* New routes */}
                    <Route path="/dao" element={<Dao />} />
                    <Route path="/dao_info" element={<DaoInfo />} />
                    <Route path="/me" element={<Me />} />
                    <Route path="/me_info" element={<MeInfo />} />
                    <Route path="/tokenomics" element={<Tokenomics />} />
                    <Route path="/tokenomics_info" element={<TokenomicsInfo />} />
                    <Route path="/sneedlock" element={<Sneedlock />} />
                    <Route path="/sneedlock_info" element={<SneedlockInfo />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/partners" element={<Partners />} />
                    <Route path="/projects" element={<Projects />} />
                    <Route path="/proposals" element={<Proposals />} />
                    <Route path="/rewards" element={<Rewards />} />
                    <Route path="/disclaimer" element={<Disclaimer />} />
                    <Route path="/principal" element={<Principal />} />
                    <Route path="/neurons" element={<Neurons />} />
                    <Route path="/transaction" element={<Transaction />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/hub" element={<Hub />} />

                    {/* Tools routes */}
                    <Route path="/tools/main" element={<ToolsMain />} />
                    <Route path="/tools/escrow" element={<ToolsEscrow />} />
                    <Route path="/tools/escrow/swap" element={<EscrowSwap />} />

                    {/* Admin routes */}
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/admin/users/bans" element={<UserBans />} />
                    <Route path="/admin/words" element={<WordBlacklist />} />
                    <Route path="/admin/partners" element={<AdminPartners />} />
                    <Route path="/admin/projects" element={<AdminProjects />} />
                    <Route path="/admin/names" element={<AdminNames />} />
                    <Route path="/admin/forum" element={<AdminForum />} />
                  </Routes>
                </Layout>
              </NamingProvider>
            </Router>
          </ForumProvider>
        </NeuronsProvider>
      </SnsProvider>
    </AuthProvider>
  );
}

export default App;