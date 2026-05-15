import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

import { DateRange } from "react-day-picker";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { DollarSign } from 'lucide-react';

interface CashboxConversionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  USDCapital: number;
  LBPCapital: number;
}

export default function CashboxConversionDialog({ open, onOpenChange, USDCapital, LBPCapital }: CashboxConversionDialogProps) {

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState<'USD' | 'LBP'>('USD');
  const [amount, setAmount] = useState(0);

  const convertionRate = 89000;

  const transactionMutation = useMutation({
    mutationFn: async () => {

      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const convertedAmount = currency === 'USD' ? amount * convertionRate : amount / convertionRate;

      const { error: cashboxError } = await (supabase.rpc as any)('update_cashbox_atomic', {
        p_date: new Date().toISOString().split('T')[0],
        p_cash_in_usd: currency === 'LBP' ? convertedAmount : 0,
        p_cash_in_lbp: currency === 'USD' ? convertedAmount : 0,
        p_cash_out_usd: currency === 'USD' ? amount : 0,
        p_cash_out_lbp: currency === 'LBP' ? amount : 0,
      });

      if (cashboxError) throw cashboxError;

      const amountUsd = currency === 'USD' ? amount * -1 : convertedAmount;
      const amountLbp = currency === 'LBP' ? amount * -1 : convertedAmount;

      // console.log("amountUsd", amountUsd, "amountLbp", amountLbp);

      const { error: cashboxTransactionError1 } = await (supabase.rpc as any)('add_cashbox_transaction', {
        transaction_type: 'OUT',
        amount_usd: currency === 'USD' ? amount : 0,
        amount_lbp: currency === 'LBP' ? amount : 0,
        note: `Converted ${amount} ${currency} to ${convertedAmount} ${currency == "USD" ? "LBP" : "USD"} - via cashbox dialog`,
      });
      if (cashboxTransactionError1) throw cashboxTransactionError1;

      const { error: cashboxTransactionError2 } = await (supabase.rpc as any)('add_cashbox_transaction', {
        transaction_type: 'IN',
        amount_usd: currency === 'LBP' ? convertedAmount : 0,
        amount_lbp: currency === 'USD' ? convertedAmount : 0,
        note: `Converted ${amount} ${currency} to ${convertedAmount} ${currency == "USD" ? "LBP" : "USD"} - via cashbox dialog`,
      });
      if (cashboxTransactionError2) throw cashboxTransactionError2;

    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: `Converted ${amount} ${currency} to ${currency == "USD" ? "LBP" : "USD"} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['cashbox'] });
      setAmount(0);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert Currency</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4">
          <Card className="w-full bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                USD Capital
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {USDCapital.toLocaleString()} $
              </div>
            </CardContent>
          </Card>
          <Card className="w-full bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                LBP Capital
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {LBPCapital.toLocaleString()} LL
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <div>
            <Label htmlFor="currency">From Currency</Label>
            <Select value={currency} onValueChange={(value: 'USD' | 'LBP') => setCurrency(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="LBP">LBP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => transactionMutation.mutate()} disabled={transactionMutation.isPending}>
              {transactionMutation.isPending ? 'Processing...' : 'Convert Currency'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
