// Унифицированные размеры иконок (lucide-react `size`).
export const ICON_XS = 12
export const ICON_SM = 14
export const ICON_MD = 16
export const ICON_LG = 18

export const UI_TEXT = {
  appName: 'PM Tool',
  nav: {
    projects: 'Projects',
    portfolio: 'Portfolio',
    settings: 'Settings',
  },
  auth: {
    login: 'Sign In',
    logout: 'Sign Out',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    emailPlaceholder: 'you@company.com',
    passwordPlaceholder: '••••••••',
    loginButton: 'Sign In',
    loggingIn: 'Signing in...',
    invalidCredentials: 'Invalid email or password',
    loginError: 'Login failed. Please try again.',
  },
  common: {
    loading: 'Loading...',
    error: 'Something went wrong',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    comingSoon: 'Coming in next iteration',
  },
} as const
