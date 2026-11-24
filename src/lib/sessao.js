import { createContext, useContext } from 'react'

export const SessaoCtx = createContext(null)
export const useSessao = () => useContext(SessaoCtx)
