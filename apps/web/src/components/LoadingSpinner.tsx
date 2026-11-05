import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', label }) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };

  return (
    <div
      data-testid="loading-spinner"
      className="flex items-center justify-center gap-2"
      role="status"
      aria-live="polite"
      aria-label={label || 'Loading…'}>
      <svg
        className={`animate-spin ${sizeClasses[size]} text-[#7b39fc]`}
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      {label && <span className="text-xs text-[#111]">{label}</span>}
    </div>
  );
};

interface SkeletonProps {
  width?: string;
  height?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = '16px' }) => {
  return (
    <div
      data-testid="skeleton"
      className="animate-pulse rounded-xl bg-[#ede6ff]"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
};
