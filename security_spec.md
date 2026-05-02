# Security Specification - Connexa

## Data Invariants
1. A user document can only be created/edited by the user themselves.
2. A friendship can only be created if both users exist.
3. Friendship status transitions follow a specific flow (pending -> accepted/declined, accepted -> blocked).
4. Messages in a direct chat must have the sender as the authenticated user.
5. Messages in a group chat must be from a current member of the group.
6. Connexa IDs must be unique and follow the format `CX-XXXXX`.

## The "Dirty Dozen" Payloads (Testing Ground)
1. **Identity Theft**: Creating a user document with someone else's UID.
2. **Ghost Friends**: Creating a friendship record for non-existent users.
3. **Privilege Escalation**: Setting `isAdmin` or `isVerified` in own user profile.
4. **Message Spoofing**: Sending a message with a `senderId` that isn't yours.
5. **Collection Scraping**: Listing all users without being authenticated.
6. **Group Injection**: Adding self to a group without being invited by admin.
7. **Bypassing Blocks**: Sending a message to a user who has blocked you.
8. **Shadow Fields**: Adding extra metadata to documents not defined in schema.
9. **Timestamp Manipulation**: Providing client-side `createdAt` timestamps.
10. **ID Poisoning**: Using a 1MB string as a document ID.
11. **Relational Deletion**: Deleting a group chat created by someone else.
12. **Status Shortcutting**: Directly setting friendship to 'accepted' without a request.

## Rules Design (Draft)
- `users`: `{userId}`
- `users/{userId}/friends/{friendId}`
- `chats`: `{chatId}`
- `chats/{chatId}/members/{memberId}`
- `chats/{chatId}/messages/{messageId}`
- `direct_messages/{dmPath}/messages/{messageId}`
