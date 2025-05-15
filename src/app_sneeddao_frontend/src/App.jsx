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
import Layout from './components/Layout';

function App() {
  return (
    <AuthProvider>
      <Router>
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
          </Routes>
        </Layout>
      </Router>
    </AuthProvider>
  );
}

export default App;