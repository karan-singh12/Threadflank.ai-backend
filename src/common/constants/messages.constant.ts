// Centralized API response messages
export const MESSAGES = {
  // Authentication
  auth: {
    loginSuccess:        'Login successful',
    signupSuccess:       'Account created successfully',
    invalidCredentials:  'Invalid email or password',
    emailExists:         'Email is already registered',
    tokenMissing:        'Access token is missing',
    tokenInvalid:        'Invalid or expired access token',
    wsTokenMissing:      'Unauthorized: Token missing',
    wsTokenInvalid:      'Unauthorized: Token invalid or expired',
    resetRequested:      'If an account exists for this email, a reset link has been sent',
    resetInvalid:        'Invalid or expired password reset token',
    resetSuccess:        'Password reset successfully',
  },

  // ─── User / Profile ───────────────────────────────────────────────────────
  user: {
    profileFetched:       'User profile fetched successfully',
    publicProfileFetched: 'Public profile fetched successfully',
    profileUpdated:       'User profile updated successfully',
    notFound:             'User not found',
    profileNotFound:      'User profile not found',
    usernameTaken:        'Username is already taken',
    cannotAddSelf:        'You cannot add yourself as a friend',
  },

  // ─── Friendship ───────────────────────────────────────────────────────────
  friendship: {
    requestSent:         'Friend request sent successfully',
    autoAccepted:        'Friend request automatically accepted',
    requestsFetched:     'Friend requests fetched successfully',
    listFetched:         'Friends list fetched successfully',
    removed:             'Friend removed successfully',
    suggestionsFetched:  'Friend suggestions fetched successfully',
    alreadyFriends:      'You are already friends with this user',
    pendingRequest:      'Friend request already sent',
    notFound:            'Friend request not found',
    notReceiver:         'You can only respond to requests sent to you',
    alreadyHandled:      'This request has already been handled',
    friendNotFound:      'Friend relationship not found',
    responded:           (status: string) => `Friend request ${status.toLowerCase()} successfully`,
  },

  // ─── Chat / Conversations / Groups ───────────────────────────────────────
  chat: {
    conversationCreated:   'Conversation created successfully',
    conversationsFetched:  'Conversations fetched successfully',
    conversationFetched:   'Conversation fetched successfully',
    conversationDeleted:   'Conversation deleted successfully',
    conversationArchived:  (archived: boolean) => archived ? 'Conversation archived' : 'Conversation unarchived',
    conversationMuted:     (muted: boolean)    => muted    ? 'Conversation muted'    : 'Conversation unmuted',
    conversationPinned:    (pinned: boolean)   => pinned   ? 'Conversation pinned'   : 'Conversation unpinned',
    groupCreated:          'Group created successfully',
    groupsFetched:         'Groups fetched successfully',
    groupFetched:          'Group fetched successfully',
    groupUpdated:          'Group updated successfully',
    groupDeleted:          'Group deleted successfully',
    membersAdded:          'Members added to group successfully',
    memberRemoved:         'Member removed from group successfully',
    leftGroup:             'Left group successfully',
    roleUpdated:           'Member role updated successfully',
    messageSent:           'Message sent successfully',
    messageEdited:         'Message updated successfully',
    messageDeleted:        'Message deleted successfully',
    messagesFetched:       'Messages fetched successfully',
    searchCompleted:       'Search completed successfully',
    unauthorized:          'You are not a member of this conversation',
    messageNotFound:       'Message not found',
    permissionDenied:      'Only the sender can perform this action',
    groupPermissionDenied: 'Only group admins can perform this action',
    notFound:              (type: string) => `${type} not found`,
  },

  // ─── File Uploads ─────────────────────────────────────────────────────────
  uploads: {
    success:     'File uploaded successfully',
    noFile:      'No file uploaded',
    invalidType: 'Only png, jpg, jpeg files are allowed',
    tooLarge:    'File size exceeds the allowed limit',
  },

  // ─── Calls ────────────────────────────────────────────────────────────────
  calls: {
    logCreated:     'Call log created successfully',
    historyFetched: 'Call history fetched successfully',
    historyCleared: 'Call history cleared successfully',
  },

  // ─── Posts / Social Feed ──────────────────────────────────────────────────
  posts: {
    created:      'Post created successfully',
    feedFetched:  'Feed fetched successfully',
    liked:        'Post liked successfully',
    unliked:      'Post unliked successfully',
    toggled:      (liked: boolean) => liked ? 'Post liked' : 'Post unliked',
    commentAdded: 'Comment added successfully',
    notFound:     'Post not found',
  },

  // ─── Admin ────────────────────────────────────────────────────────────────
  admin: {
    statsFetched:         'Dashboard statistics fetched successfully',
    usersFetched:         'Users list fetched successfully',
    userFetched:          'User details fetched successfully',
    userUpdated:          'User updated successfully',
    userNotFound:         'User not found',
    userActivated:        'User activated successfully',
    userDeactivated:      'User deactivated successfully',
    userRoleUpdated:      'User role updated successfully',
    trafficFetched:       'Traffic logs fetched successfully',
    suspiciousFetched:    'Suspicious traffic logs fetched successfully',
    trafficCleared:       'Traffic logs cleared successfully',
    unauthorized:         'Admin access required',
  },

  // ─── Admin Auth (separate staff/admin identity) ──────────────────────────
  adminAuth: {
    loginSuccess:        'Login successful',
    logoutSuccess:       'Logged out successfully',
    invalidCredentials:  'Invalid email or password',
    accountInactive:     'This admin account has been deactivated',
    emailExists:         'An admin with this email already exists',
    adminCreated:        'Admin account created successfully',
    tokenMissing:        'Admin access token is missing',
    tokenInvalid:        'Invalid or expired admin access token',
    refreshInvalid:      'Invalid or expired refresh token',
    refreshed:           'Token refreshed successfully',
    resetRequested:      'If an account exists for this email, a reset link has been sent',
    resetInvalid:        'Invalid or expired password reset token',
    resetSuccess:        'Password reset successfully',
    currentFetched:      'Current admin fetched successfully',
    listFetched:         'Admins fetched successfully',
    forbidden:            (roles: string[]) => `Access denied. Required admin roles: ${roles.join(', ')}`,
  },

  // ─── Brands ────────────────────────────────────────────────────────────────
  brands: {
    created:      'Brand created successfully',
    updated:      'Brand updated successfully',
    deleted:      'Brand deleted successfully',
    fetched:      'Brand fetched successfully',
    listFetched:  'Brands fetched successfully',
    notFound:     'Brand not found',
    slugTaken:    'A brand with this slug already exists',
    managerAssigned:   'Brand manager assigned successfully',
    managerUnassigned: 'Brand manager unassigned successfully',
    notAssigned:  'You are not assigned to manage this brand',
  },

  // ─── Brand Posts (Discover / Trending feed) ──────────────────────────────
  brandPosts: {
    created:        'Brand post created successfully',
    updated:        'Brand post updated successfully',
    deleted:        'Brand post deleted successfully',
    fetched:        'Brand post fetched successfully',
    listFetched:    'Brand posts fetched successfully',
    notFound:       'Brand post not found',
    published:      'Brand post published successfully',
    scheduled:      'Brand post scheduled successfully',
    captionGenerated: 'Caption generated successfully',
    invalidTransition: (from: string, to: string) => `Cannot move post from ${from} to ${to}`,
  },

  // ─── Brand Stories ────────────────────────────────────────────────────────
  brandStories: {
    created:      'Brand story created successfully',
    deleted:      'Brand story deleted successfully',
    fetched:      'Brand story fetched successfully',
    listFetched:  'Brand stories fetched successfully',
    notFound:     'Brand story not found or has expired',
  },

  // ─── Email Templates ──────────────────────────────────────────────────────
  emailTemplates: {
    created:      'Email template created successfully',
    updated:      'Email template updated successfully',
    deleted:      'Email template deleted successfully',
    fetched:      'Email template fetched successfully',
    listFetched:  'Email templates fetched successfully',
    notFound:     'Email template not found',
    keyTaken:     'An email template with this key already exists',
    previewed:    'Template preview rendered successfully',
    testSent:     'Test email sent successfully',
  },

  // ─── CMS Content Blocks ───────────────────────────────────────────────────
  cms: {
    created:      'Content block created successfully',
    updated:      'Content block updated successfully',
    deleted:      'Content block deleted successfully',
    fetched:      'Content block fetched successfully',
    listFetched:  'Content blocks fetched successfully',
    notFound:     'Content block not found',
    keyTaken:     'A content block with this key already exists',
    published:    'Content block published successfully',
  },

  // ─── Admin-side User Management ──────────────────────────────────────────
  adminUsers: {
    listFetched:  'Users fetched successfully',
    fetched:      'User fetched successfully',
    notFound:     'User not found',
    suspended:    'User suspended successfully',
    unsuspended:  'User unsuspended successfully',
    alreadySuspended:   'User is already suspended',
    notSuspended:       'User is not currently suspended',
  },

  // ─── GenAI SDK ────────────────────────────────────────────────────────────
  sdk: {
    captionGenerated:   'Caption generated successfully',
    ragAnswered:        'Query answered successfully',
    occasionPlanned:    'Outfit recommendations generated successfully',
    providerFailure:    'All configured AI providers failed to handle this request',
  },

  // ─── Common / Generic ─────────────────────────────────────────────────────
  common: {
    success:         'Operation completed successfully',
    notFound:        'Resource not found',
    unauthorized:    'You are not authorized to perform this action',
    serverError:     'Something went wrong. Please try again later.',
    validationFailed:'Validation failed',
    forbidden:       (roles: string[]) => `Access denied. Required roles: ${roles.join(', ')}`,
  },
} as const;

// ─── Re-export for backward compatibility (replaces legacy responseMssg.ts) ─
export { MESSAGES as MSG };
