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
import { AuthProvider } from './AuthContext';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/doc" element={<Doc />} />
          <Route path="/help" element={<Help />} />
          <Route path="/rll" element={<RLL />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/tokenlock" element={<TokenLock />} />
          <Route path="/positionlock" element={<PositionLock />} />
          <Route path="/tokenlocksoverview" element={<TokenLocksOverview />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;