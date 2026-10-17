// frontend/src/App.jsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';

// Import all components
import DashboardLayout from './components/DashboardLayout';
import DashboardPage from './components/DashboardPage';
import ReportIssuePage from './components/ReportIssuePage';
import PublicMapPage from './components/PublicMapPage';
import AuthPage from './components/AuthPage';
import MyProfilePage from './components/MyProfilePage';
import AdminDashboardPage from './components/AdminDashboardPage';
import AllIssuesPage from './components/AllIssuesPage';
import IssueDetailPage from './components/IssueDetailPage';
import VolunteerRequestsPage from './components/VolunteerRequestsPage';

export default function App() {
  const [userInfo, setUserInfo] = useState(null);
  const [currentPage, setCurrentPage] = useState('home');
  const [issues, setIssues] = useState([]);
  const [selectedIssueId, setSelectedIssueId] = useState(null);

  useEffect(() => {
    const storedUserInfo = localStorage.getItem('userInfo');
    if (storedUserInfo) {
      setUserInfo(JSON.parse(storedUserInfo));
    }
  }, []);

  useEffect(() => {
    const fetchIssues = async () => {
      try {
        const { data } = await axios.get(`${import.meta.env.VITE_API_URL}/api/issues`);
        const adaptedIssues = data.map(issue => ({ ...issue, filePreview: issue.imageUrl }));
        setIssues(adaptedIssues);
      } catch (error) {
        console.error('Could not fetch issues:', error);
      }
    };
    if (userInfo) {
      fetchIssues();
    }
  }, [userInfo]);

  const navigateTo = (page, id = null) => {
    setCurrentPage(page);
    setSelectedIssueId(id);
  };

  // ✅ START: MODIFIED FUNCTION
  const handleAddIssue = async (formData, wantsToVolunteer) => {
    let newIssue; // Define newIssue in the outer scope
    const { token } = JSON.parse(localStorage.getItem('userInfo'));
    const config = { headers: { Authorization: `Bearer ${token}` } };

    try {
      // --- Step 1: Create the issue ---
      // This is the main action. If it fails, we'll alert the user.
      const { data } = await axios.post(`${import.meta.env.VITE_API_URL}/api/issues`, formData, config);
      newIssue = data; // Assign the response data

      const finalIssue = { ...newIssue, filePreview: newIssue.imageUrl };

      // --- Step 2: Update state and navigate ---
      // Do this immediately after the main action succeeds.
      setIssues(prevIssues => [finalIssue, ...prevIssues]);
      navigateTo('my-profile'); // <-- SUCCESS! You will now be redirected.

    } catch (error) {
      // This block only catches errors from the *issue creation*
      console.error('Error creating issue:', error);
      alert('Failed to create issue. Please try again.');
      return; // Stop execution if the main creation failed
    }

    // --- Step 3: Handle volunteering separately ---
    // This runs *after* navigation, and has its own error handling.
    if (wantsToVolunteer && newIssue) {
      try {
        await axios.post(`${import.meta.env.VITE_API_URL}/api/issues/${newIssue._id}/volunteer`, {}, config);

        // Update the state again to add the volunteer status
        setIssues(prevIssues =>
          prevIssues.map(issue =>
            issue._id === newIssue._id
              ? { ...issue, volunteerRequest: 'Pending' }
              : issue
          )
        );
      } catch (volunteerError) {
        console.error('Issue was created, but failed to submit volunteer request:', volunteerError);
        // You could show a non-blocking toast message here
        alert('Your issue was created, but we failed to register your volunteer request. You can try volunteering from the issue page.');
      }
    }
  };
  // ✅ END: MODIFIED FUNCTION

  const handleLoginSuccess = (data) => {
    const userInfo = { ...data.user, token: data.token };
    localStorage.setItem('userInfo', JSON.stringify(userInfo));
    setUserInfo(userInfo);
    setCurrentPage('home');
  };

  const handleLogout = () => {
    localStorage.removeItem('userInfo');
    setUserInfo(null);
    setIssues([]);
    setCurrentPage('home');
  };

  const renderPageContent = () => {
    switch (currentPage) {
      case 'home':
        return <DashboardPage issues={issues} />;
      case 'report':
        return <ReportIssuePage navigateTo={navigateTo} onReportSubmit={handleAddIssue} />;
      case 'map':
        return <PublicMapPage issues={issues} />;
      case 'my-profile':
        return <MyProfilePage userInfo={userInfo} />;
      case 'all-issues':
        return <AllIssuesPage navigateTo={navigateTo} />;
      case 'issue-detail':
        return <IssueDetailPage issueId={selectedIssueId} navigateTo={navigateTo} userInfo={userInfo} />;
      case 'admin-dashboard':
        if (userInfo && userInfo.isAdmin) {
          // ✅ THE FIX: Pass the userInfo prop here
          return <AdminDashboardPage issues={issues} setIssues={setIssues} navigateTo={navigateTo} userInfo={userInfo} />;
        }
        return <DashboardPage issues={issues} />;
      case 'volunteer-requests':
        if (userInfo && userInfo.isAdmin) {
          return <VolunteerRequestsPage userInfo={userInfo} />;
        }
        return <DashboardPage issues={issues} />;
      default:
        return <DashboardPage issues={issues} />;
    }
  };

  if (!userInfo) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <DashboardLayout
      navigateTo={navigateTo}
      userInfo={userInfo}
      onLogout={handleLogout}
    >
      {renderPageContent()}
    </DashboardLayout>
  );
}