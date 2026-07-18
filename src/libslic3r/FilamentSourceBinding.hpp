#ifndef slic3r_FilamentSourceBinding_hpp_
#define slic3r_FilamentSourceBinding_hpp_

#include "FilamentSourceProvider.hpp"

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <exception>
#include <functional>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>

namespace Slic3r::MultiAce {

// Bridges arbitrary provider callback threads to an owner-thread dispatcher.
// The apply callback is never invoked directly by the provider callback.
class FilamentSourceBinding
{
public:
    using DispatchCallback = std::function<void()>;
    using Dispatcher       = std::function<void(DispatchCallback)>;
    using ApplyCallback    = std::function<void(const InventorySnapshot&)>;

    FilamentSourceBinding(std::shared_ptr<FilamentSourceProvider> provider, Dispatcher dispatcher, ApplyCallback apply)
        : m_provider(std::move(provider)), m_state(std::make_shared<State>())
    {
        if (!m_provider)
            throw std::invalid_argument("multiACE filament source provider is required");
        if (!dispatcher)
            throw std::invalid_argument("multiACE inventory dispatcher is required");
        if (!apply)
            throw std::invalid_argument("multiACE inventory apply callback is required");

        m_state->dispatcher = std::move(dispatcher);
        m_state->apply      = std::move(apply);

        const std::weak_ptr<State> weak_state = m_state;
        m_subscription_id = m_provider->subscribe([weak_state](const InventorySnapshot& snapshot) {
            const std::shared_ptr<State> state = weak_state.lock();
            if (!state)
                return;
            const std::uint64_t sequence = state->next_sequence.fetch_add(1, std::memory_order_relaxed);
            enqueue(state, sequence, snapshot);
        });
        if (m_subscription_id == FilamentSourceProvider::INVALID_SUBSCRIPTION_ID)
            throw std::runtime_error("multiACE provider rejected inventory subscription");

        try {
            const InventorySnapshot initial = m_provider->inventory();
            if (!initial.revision.empty())
                enqueue(m_state, INITIAL_SEQUENCE, initial);
        } catch (const std::exception& error) {
            set_error(m_state, error.what());
        } catch (...) {
            set_error(m_state, "multiACE initial inventory read failed with an unknown error");
        }
    }

    ~FilamentSourceBinding() { detach(); }

    FilamentSourceBinding(const FilamentSourceBinding&)            = delete;
    FilamentSourceBinding& operator=(const FilamentSourceBinding&) = delete;
    FilamentSourceBinding(FilamentSourceBinding&&)                 = delete;
    FilamentSourceBinding& operator=(FilamentSourceBinding&&)      = delete;

    void detach()
    {
        std::shared_ptr<FilamentSourceProvider> provider;
        FilamentSourceProvider::SubscriptionId subscription_id = FilamentSourceProvider::INVALID_SUBSCRIPTION_ID;
        {
            std::lock_guard<std::mutex> lock(m_lifecycle_mutex);
            if (m_detached)
                return;
            m_detached       = true;
            provider         = m_provider;
            subscription_id  = m_subscription_id;
            m_subscription_id = FilamentSourceProvider::INVALID_SUBSCRIPTION_ID;
        }

        {
            std::lock_guard<std::mutex> lock(m_state->mutex);
            m_state->active = false;
            m_state->pending.clear();
        }

        if (provider && subscription_id != FilamentSourceProvider::INVALID_SUBSCRIPTION_ID) {
            try {
                provider->unsubscribe(subscription_id);
            } catch (...) {
            }
        }

        std::unique_lock<std::mutex> state_lock(m_state->mutex);
        m_state->callbacks_drained.wait(state_lock, [this] { return m_state->active_apply_callbacks == 0; });
        m_state->dispatcher = {};
        m_state->apply      = {};
        m_state->pending.clear();
        m_state->dispatch_scheduled = false;
    }

    bool detached() const
    {
        std::lock_guard<std::mutex> lock(m_lifecycle_mutex);
        return m_detached;
    }

    std::string last_error() const
    {
        std::lock_guard<std::mutex> lock(m_state->mutex);
        return m_state->last_error;
    }

    std::shared_ptr<FilamentSourceProvider> provider() const
    {
        std::lock_guard<std::mutex> lock(m_lifecycle_mutex);
        return m_provider;
    }

private:
    static constexpr std::uint64_t INITIAL_SEQUENCE = 1;
    static constexpr std::uint64_t FIRST_CALLBACK_SEQUENCE = 2;

    struct PendingInventory
    {
        std::uint64_t    sequence = 0;
        InventorySnapshot snapshot;
    };

    struct State
    {
        std::mutex              mutex;
        std::condition_variable callbacks_drained;
        Dispatcher              dispatcher;
        ApplyCallback           apply;
        std::deque<PendingInventory> pending;
        std::atomic<std::uint64_t>   next_sequence{FIRST_CALLBACK_SEQUENCE};
        std::uint64_t                last_consumed_sequence = 0;
        std::size_t                  active_apply_callbacks = 0;
        bool                         active                 = true;
        bool                         dispatch_scheduled     = false;
        std::string                  last_error;
    };

    static void enqueue(const std::shared_ptr<State>& state, std::uint64_t sequence, InventorySnapshot snapshot)
    {
        Dispatcher dispatcher;
        {
            std::lock_guard<std::mutex> lock(state->mutex);
            if (!state->active)
                return;
            state->pending.push_back(PendingInventory{sequence, std::move(snapshot)});
            if (state->dispatch_scheduled)
                return;
            state->dispatch_scheduled = true;
            dispatcher                = state->dispatcher;
        }

        const std::weak_ptr<State> weak_state = state;
        try {
            dispatcher([weak_state] { drain(weak_state); });
        } catch (const std::exception& error) {
            dispatch_failed(state, error.what());
        } catch (...) {
            dispatch_failed(state, "multiACE inventory dispatch failed with an unknown error");
        }
    }

    static void drain(const std::weak_ptr<State>& weak_state)
    {
        const std::shared_ptr<State> state = weak_state.lock();
        if (!state)
            return;

        for (;;) {
            PendingInventory pending;
            ApplyCallback    apply;
            {
                std::lock_guard<std::mutex> lock(state->mutex);
                if (!state->active) {
                    state->pending.clear();
                    state->dispatch_scheduled = false;
                    return;
                }
                if (state->pending.empty()) {
                    state->dispatch_scheduled = false;
                    return;
                }

                pending = std::move(state->pending.front());
                state->pending.pop_front();
                if (pending.sequence <= state->last_consumed_sequence)
                    continue;

                // Consume the sequence before applying it. If a newer snapshot fails
                // validation, an older snapshot queued later must never overwrite the
                // last known-good model state.
                state->last_consumed_sequence = pending.sequence;
                apply                         = state->apply;
                ++state->active_apply_callbacks;
            }

            try {
                apply(pending.snapshot);
                clear_error(state);
            } catch (const std::exception& error) {
                set_error(state, error.what());
            } catch (...) {
                set_error(state, "multiACE inventory apply failed with an unknown error");
            }

            {
                std::lock_guard<std::mutex> lock(state->mutex);
                --state->active_apply_callbacks;
                if (state->active_apply_callbacks == 0)
                    state->callbacks_drained.notify_all();
            }
        }
    }

    static void dispatch_failed(const std::shared_ptr<State>& state, std::string error)
    {
        std::lock_guard<std::mutex> lock(state->mutex);
        if (!state->active)
            return;
        state->dispatch_scheduled = false;
        state->pending.clear();
        state->last_error = std::move(error);
    }

    static void set_error(const std::shared_ptr<State>& state, std::string error)
    {
        std::lock_guard<std::mutex> lock(state->mutex);
        state->last_error = std::move(error);
    }

    static void clear_error(const std::shared_ptr<State>& state)
    {
        std::lock_guard<std::mutex> lock(state->mutex);
        state->last_error.clear();
    }

    mutable std::mutex                         m_lifecycle_mutex;
    std::shared_ptr<FilamentSourceProvider>    m_provider;
    std::shared_ptr<State>                     m_state;
    FilamentSourceProvider::SubscriptionId     m_subscription_id = FilamentSourceProvider::INVALID_SUBSCRIPTION_ID;
    bool                                       m_detached        = false;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_FilamentSourceBinding_hpp_
