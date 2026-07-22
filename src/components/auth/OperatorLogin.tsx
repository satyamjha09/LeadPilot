import { type FormEvent, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function OperatorLogin({
  onSubmit,
  isLoading
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
  isLoading: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    }
  };

  return (
    <div className="tk-grid-background grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md border-sky-200/80 shadow-xl">
        <CardHeader className="space-y-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div>
            <CardTitle className="text-2xl">LeadPilot Operator</CardTitle>
            <CardDescription>Sign in to manage lead automation.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="operator-email">Email</Label>
              <Input
                id="operator-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                disabled={isLoading}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operator-password">Password</Label>
              <div className="relative">
                <Input
                  id="operator-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={isLoading}
                  required
                  className="pr-11"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={isLoading}>
              <LogIn className="h-4 w-4" />
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
