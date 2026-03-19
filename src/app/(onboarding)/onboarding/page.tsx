'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { useMutation, useAction } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const formSchema = z.object({
  name: z.string().min(3, 'Organization name must be at least 3 characters'),
  email: z.string().email('A valid email is required'),
  phone: z.string().optional(),
})

export default function OnboardingPage() {
  const router = useRouter()
  const createWithGhl = useAction(api.tenants.createWithGhl)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
    },
  })

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await createWithGhl({
        name: values.name,
        email: values.email,
        phone: values.phone || undefined,
      })
      // Navigate to welcome page with tenant info
      const params = new URLSearchParams({
        tenantId: res.tenantId,
        name: values.name,
        ...(res.ghlLocationId && { locationId: res.ghlLocationId }),
      })
      router.push(`/welcome?${params.toString()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md space-y-8"
      >
        {/* Logo / Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-xl bg-primary/10 mb-2">
            <span className="text-xl font-bold text-primary">P</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Pulse</h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Set up your studio or agency to get started. We'll create your workspace and connect your backend systems.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 justify-center">
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-primary" />
            <span className="text-xs font-medium text-primary">Create Organization</span>
          </div>
          <div className="w-8 h-px bg-border" />
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-muted" />
            <span className="text-xs text-muted-foreground">Dashboard</span>
          </div>
        </div>

        {/* Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Awesome Studio" {...field} />
                  </FormControl>
                  <FormDescription>Your studio, label, or agency name.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business Email</FormLabel>
                  <FormControl>
                    <Input placeholder="hello@yourstudio.com" {...field} />
                  </FormControl>
                  <FormDescription>Used for client communications and notifications.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <FormControl>
                    <Input placeholder="+1 (555) 000-0000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Setting up your workspace...
                </span>
              ) : (
                'Create Organization'
              )}
            </Button>
          </form>
        </Form>

        <p className="text-center text-xs text-muted-foreground">
          By continuing, you agree to our Terms of Service.
        </p>
      </motion.div>
    </div>
  )
}
