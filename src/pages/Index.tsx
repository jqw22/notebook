import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { NotebookPen, Shield, Key, ArrowRight } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';

const Index = () => {
  useSeoMeta({
    title: 'Notebook',
    description: 'A private, encrypted notebook powered by Nostr NIP-44 encryption.',
  });

  const { user } = useCurrentUser();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center space-y-8">
        {/* Icon */}
        <div className="mx-auto w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center">
          <NotebookPen className="h-10 w-10 text-primary" />
        </div>

        {/* Heading */}
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Notebook
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Your personal encrypted notebook on Nostr. Notes are end-to-end
            encrypted with NIP-44 and stored on relays you control.
          </p>
        </div>

        {/* Features */}
        <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Key className="h-4 w-4" />
            NIP-44 Encrypted
          </span>
          <span className="flex items-center gap-1.5">
            <Shield className="h-4 w-4" />
            Self-Sovereign
          </span>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {user ? (
            <Button asChild size="lg" className="gap-2">
              <Link to="/notes">
                Open Notebook
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <>
              <LoginArea className="max-w-48" />
              <span className="text-sm text-muted-foreground">
                to access your notebook
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
