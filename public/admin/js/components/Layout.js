// Main Layout component that wraps the entire admin interface
const { useState, useEffect } = React;

const Layout = ({ children, currentPage, onPageChange }) => {
    const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 1024);
    
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 1024) {
                setSidebarOpen(false);
            }
        };
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const toggleSidebar = () => {
        setSidebarOpen(!sidebarOpen);
    };

    const handlePageChange = (page) => {
        onPageChange(page);
        // Close sidebar on mobile after navigation
        if (window.innerWidth < 1024) {
            setSidebarOpen(false);
        }
    };

    return React.createElement('div', { className: 'admin-layout' },
        React.createElement(Sidebar, {
            isOpen: sidebarOpen,
            currentPage,
            onPageChange: handlePageChange
        }),
        React.createElement('div', { className: 'main-content' },
            React.createElement(Header, {
                onToggleSidebar: toggleSidebar,
                currentPage
            }),
            React.createElement('div', { className: 'page-content' },
                children
            )
        ),
        // Overlay for mobile
        sidebarOpen && window.innerWidth < 1024 && React.createElement('div', {
            className: 'fixed inset-0 bg-black bg-opacity-50 z-40',
            onClick: () => setSidebarOpen(false)
        })
    );
};