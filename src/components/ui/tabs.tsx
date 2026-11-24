import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "text-muted-foreground flex w-full items-stretch gap-1 overflow-x-auto border-b [scrollbar-width:none] max-sm:gap-0",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "hover:text-foreground data-[state=active]:text-foreground focus-visible:ring-ring/40 after:bg-primary relative inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-t-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:opacity-0 after:transition-opacity focus-visible:ring-[3px] focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 data-[state=active]:after:opacity-100 max-sm:px-2.5 pointer-coarse:h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
