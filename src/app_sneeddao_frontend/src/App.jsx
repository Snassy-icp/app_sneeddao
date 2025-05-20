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
import Rewards from './pages/Rewards';
import Disclaimer from './pages/Disclaimer';
import Principal from './pages/Principal';
import Neurons from './pages/Neurons';

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
              <Route path="/proposals" element={<Proposals />} />
              <Route path="/rewards" element={<Rewards />} />
              <Route path="/disclaimer" element={<Disclaimer />} />
              <Route path="/principal" element={<Principal />} />
              <Route path="/neurons" element={<Neurons />} />

              {/* Admin routes */}
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/users/bans" element={<UserBans />} />
              <Route path="/admin/words" element={<WordBlacklist />} />
            </Routes>
          </Layout>
        </NamingProvider>
      </Router>
    </AuthProvider>
  );
}

export default App;