import React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface ResponsiveLayoutProps {
  children: React.ReactNode;
  mobileView?: React.ReactNode;
  desktopView?: React.ReactNode;
}

const ResponsiveLayout: React.FC<ResponsiveLayoutProps> = ({ 
  children, 
  mobileView, 
  desktopView 
}) => {
  const isMobile = useIsMobile();

  return (
    <div className={cn("layout", isMobile ? 'mobile' : 'desktop')}>
      {isMobile ? mobileView : desktopView}
      <div className="layout-content">
        {children}
      </div>
    </div>
  );
};

export default ResponsiveLayout;
