import { QueryClient } from '@tanstack/react-query'

// Единый экземпляр — используется и провайдером (main.tsx), и axios-интерсептором
// (client.ts), чтобы после мутаций инвалидировать журнал действий без ручных вызовов.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // на возврате в вкладку не рефетчим всё разом (шторм ~6 запросов в ops-режиме портфеля);
      // свежесть держат staleTime + инвалидация после мутаций (projectTaskQueries).
      refetchOnWindowFocus: false,
    },
  },
})
