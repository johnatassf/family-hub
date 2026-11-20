import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from '@familia/ui';
import { Layout } from './Layout';
import { webModules } from './modules';
import { Family } from './pages/Family';
import { ForgotPassword } from './pages/ForgotPassword';
import { Login } from './pages/Login';
import { Security } from './pages/Security';
import { Signup } from './pages/Signup';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/cadastro', element: <Signup /> },
  { path: '/esqueci-senha', element: <ForgotPassword /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to={`/${webModules[0]!.basePath}`} replace /> },
      ...webModules.map((m) => ({ path: m.basePath, children: m.routes })),
      { path: 'familia', element: <Family /> },
      { path: 'seguranca', element: <Security /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
